-- A ledger's GSTIN and PAN in the cloud copy, request of 02-Oct-2026 (a bill's supplier matched to its Tally ledger by
-- GSTIN first: KIS/335 of KASHI I.T SOLUTIONS, GSTIN 09DEYPD8166R1Z5, went to "Aadi Info Solutions Pvt. Ltd" because the
-- bill screen had no way to find "Kashi IT Solutions" by its GSTIN). FinCom Bridge 2.1.2 reads them with the ledger masters
-- and sends them with the ledgers. Adds only; nothing is dropped or deleted.
--   tally_ledgers + gstin, pan
--   tally_ingest_ledger_ids(book, [[name, gstin, pan], ...])   called by tally-ingest after the ledgers are taken

begin;

alter table public.tally_ledgers add column if not exists gstin text;
alter table public.tally_ledgers add column if not exists pan text;
create index if not exists tally_ledgers_gstin on public.tally_ledgers (book_id, gstin) where gstin is not null and gstin <> '';

create or replace function public.tally_ingest_ledger_ids(p_book uuid, p_ids jsonb)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare n integer := 0;
begin
  if auth.role() <> 'service_role' then raise exception 'not allowed' using errcode = '42501'; end if;
  update tally_ledgers l set gstin = nullif(upper(btrim(coalesce(x->>1, ''))), ''), pan = nullif(upper(btrim(coalesce(x->>2, ''))), '')
    from jsonb_array_elements(coalesce(p_ids, '[]'::jsonb)) x
   where l.book_id = p_book and l.merged_into is null and l.name = tally_nm(x->>0)
     and (l.gstin is distinct from nullif(upper(btrim(coalesce(x->>1, ''))), '') or l.pan is distinct from nullif(upper(btrim(coalesce(x->>2, ''))), ''));
  get diagnostics n = row_count;
  return jsonb_build_object('ok', true, 'ids', n);
end $function$;
revoke all on function public.tally_ingest_ledger_ids(uuid, jsonb) from public, anon, authenticated;

commit;
