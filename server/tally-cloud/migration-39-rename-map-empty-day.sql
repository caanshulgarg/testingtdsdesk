-- Migration 39 (03-Oct-2026, round 10: the owner's three gaps). Runs AFTER 36, 36b, 37 and 38 (both orders of
-- docs/MIGRATION-ORDER.md). Add-only: one column, functions created or replaced with the arguments tally-ingest and the app
-- call (tally_ingest_day gains an 8-argument form; the 7-argument one stays and passes null). Safe to run twice. Shown to
-- the owner before it runs.
--
--   1. a rename carries the saved choices   tally_ledger_rename (36's text, the same arguments) now also calls
--      tally_ledger_carry_choices(book, from, to) in the same transaction: the client_book_items kept per ledger name
--      (key 'map' item '.' || name, read by tally_led_kinds for GST / TDS; and 'ledInfo', 'gstins', 'pans' the same way)
--      get a new-name item when none is there (the old row is KEPT and marked carriedTo / carriedAt in its data; nothing
--      deleted); when both names have an item the new name's stands and the clash is noted (the answer and before_clean);
--      clients.data->'choices' gets 'flow:<new name>' beside 'flow:<old name>' and any choice whose value is the old name
--      (gst:*, tds:*, exp, bank:*, sales:*) takes the new one, the old kept as prev. The row renamed (or the row that stays
--      in a merge) is flagged tally_ledgers.needs_confirm = true (read by the Tally / ledgers page) and its
--      before_clean.renamed[] entry carries confirm: true, until an owner clears it with tally_ledger_rename_confirm(book,
--      name) (owner-only; who and when kept on the entry).
--      Ledger names FinCom keeps elsewhere and NOT carried here: the browser's BankDB (bank rules 'rules:', written rules
--      'wrules:', 'newled:', 'sales:' config: not in the database; the app matches a rule's ledger against Tally's list
--      and asks again), a bill's snapshot lines / partyLedger / expenseLedger (the entry's history; a waiting bill is
--      checked against Tally's ledgers before posting), tally_post_jobs.payload (the XML as sent: history), ledSnaps /
--      tbCheck items (snapshots and check results, worked out again), tally_ledger_marks.ledger (history).
--   2. an empty day is not a short read   tally_ingest_day(…, p_empty boolean) (8 arguments; the 7-argument one passes
--      null): p_n = 0 with p_empty = true (the bridge positively read the day and Tally listed no entries) marks the day's
--      live entries deleted (soft) and answers marked n, empty: true; p_n = 0 without the flag, or n < p_n, is a short
--      read as 38 (nothing marked, refused: 'short read: n of p_n'); a later file with entries un-marks them.
--   3. ids live by a confirmation too   tally_post_ids_sync keeps an id live, when the posting fails or is cancelled,
--      also when its result or item is confirmed (verified, in_tally, sent) or ok, stamped or not, besides 38's
--      accepted-unconfirmed set and 36b's accepted_at.
--   Every function here: security definer, search_path = public, pg_temp; grants as before.

begin;

alter table public.tally_ledgers add column if not exists needs_confirm boolean not null default false;   -- a rename the owner has not confirmed yet

-- ---------------------------------------------------------------- 1. the saved choices keyed by a ledger's name follow the name
create or replace function public.tally_ledger_carry_choices(p_book uuid, p_from text, p_to text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $function$
declare f uuid; cid text; k text; v jsonb; ch jsonb; n_items int := 0; n_flow int := 0; n_vals int := 0; clash text[] := '{}';
begin
  select firm_id, client_id into f, cid from tally_books where book_id = p_book;
  if f is null or coalesce(p_from, '') = '' or coalesce(p_to, '') = '' or p_from = p_to then return jsonb_build_object('items', 0, 'flow', 0, 'values', 0, 'clash', '[]'::jsonb); end if;
  -- client_book_items: the per-ledger items ('.' || name) of the keys that hold work by ledger name
  begin
    foreach k in array array['map', 'ledInfo', 'gstins', 'pans'] loop
      if exists (select 1 from client_book_items i where i.firm_id = f and i.client_id = cid and i.key = k and i.item = '.' || p_from and not i.deleted) then
        if exists (select 1 from client_book_items i where i.firm_id = f and i.client_id = cid and i.key = k and i.item = '.' || p_to and not i.deleted) then
          clash := clash || k;
        else
          insert into client_book_items (firm_id, client_id, key, item, ord, data, deleted, updated_at, updated_by)
          select i.firm_id, i.client_id, i.key, '.' || p_to, i.ord, i.data, false, now(), i.updated_by from client_book_items i
           where i.firm_id = f and i.client_id = cid and i.key = k and i.item = '.' || p_from and not i.deleted
          on conflict (firm_id, client_id, key, item) do update set data = excluded.data, deleted = false, updated_at = now();
          n_items := n_items + 1;
        end if;
        update client_book_items i set data = coalesce(i.data, '{}'::jsonb) || jsonb_build_object('carriedTo', p_to, 'carriedAt', now()), updated_at = now()
         where i.firm_id = f and i.client_id = cid and i.key = k and i.item = '.' || p_from and not i.deleted and jsonb_typeof(i.data) = 'object';
      end if;
    end loop;
  exception when undefined_table then null;      -- a database without client_book_items (migration 12): nothing to carry
  end;
  -- clients.data->'choices': the key 'flow:<old name>' (the new name added beside it), and values that are the old name
  begin
    select data->'choices' into ch from clients where firm_id = f and id = cid;
    if jsonb_typeof(ch) = 'object' then
      if ch ? ('flow:' || p_from) and not ch ? ('flow:' || p_to) then ch := ch || jsonb_build_object('flow:' || p_to, ch->('flow:' || p_from)); n_flow := 1; end if;
      for k, v in select * from jsonb_each(ch) loop
        if k <> 'postTo' and jsonb_typeof(v) = 'object' and v->>'value' = p_from then
          ch := jsonb_set(ch, array[k], v || jsonb_build_object('value', p_to, 'prev', p_from, 'carriedAt', now())); n_vals := n_vals + 1;
        end if;
      end loop;
      if n_flow + n_vals > 0 then update clients set data = jsonb_set(coalesce(data, '{}'::jsonb), '{choices}', ch) where firm_id = f and id = cid; end if;
    end if;
  exception when undefined_table or undefined_column then null;
  end;
  return jsonb_build_object('items', n_items, 'flow', n_flow, 'values', n_vals, 'clash', to_jsonb(clash));
end $function$;
revoke all on function public.tally_ledger_carry_choices(uuid, text, text) from public, anon, authenticated;

-- migration 36's rename (the same arguments and rules: the row by GUID, the cascade, the trial balance before and after, the
-- merge), plus: the saved choices carried, needs_confirm set, the renamed entry flagged confirm: true
create or replace function public.tally_ledger_rename(p_book uuid, p_guid text, p_from text, p_to text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $function$
declare f uuid; g text := nullif(left(btrim(coalesce(p_guid, '')), 100), ''); frm text := left(btrim(coalesce(p_from, '')), 300); dst text := left(btrim(coalesce(p_to, '')), 300);
  row_name text; row_guid text; other_name text; other_guid text; other_gone boolean; hist boolean; kept boolean; why text;
  tb_before numeric; tb_after numeric; moved jsonb; o_open numeric; o_sent numeric; lst jsonb; carried jsonb;
begin
  if auth.role() <> 'service_role' then raise exception 'not allowed' using errcode = '42501'; end if;
  select firm_id into f from tally_books where book_id = p_book;
  if f is null then raise exception 'no such book'; end if;
  if dst = '' then return jsonb_build_object('ok', true, 'renamed', false, 'note', 'no new name'); end if;
  perform pg_advisory_xact_lock(hashtext(p_book::text));
  -- the row: by its GUID (a live row first), else by the old name where no GUID is held yet
  if g is not null then
    select name, tally_guid into row_name, row_guid from tally_ledgers where book_id = p_book and tally_guid = g order by (deleted_at is null) desc limit 1;
  end if;
  if row_name is null and frm <> '' then
    select name, tally_guid into row_name, row_guid from tally_ledgers where book_id = p_book and name = frm and tally_guid is null;
  end if;
  if row_name is null then return jsonb_build_object('ok', true, 'renamed', false, 'note', 'no such ledger: ' || frm); end if;
  if row_name = dst then return jsonb_build_object('ok', true, 'renamed', false, 'note', 'already named so'); end if;
  select exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'tally_ledgers' and column_name = 'before_clean') into hist;
  select name, tally_guid, deleted_at is not null into other_name, other_guid, other_gone from tally_ledgers where book_id = p_book and name = dst;
  if other_name is not null and other_guid is not null and g is not null and other_guid <> g then
    return jsonb_build_object('ok', true, 'renamed', false, 'refused', true, 'from', row_name, 'to', dst,
      'note', format('rename %s -> %s: that name is another ledger''s (GUID %s); left', row_name, dst, other_guid));
  end if;
  -- the trial balance before: the sum of closing balances over the book (0 when it ties)
  select round(coalesce(sum(closing), 0), 2) into tb_before from tally_balances where book_id = p_book;
  if tb_before <> 0 then
    raise exception 'the trial balance of this book does not tie (the closing balances add up to %, not 0); % cannot be renamed until it does', tb_before, row_name using errcode = 'P0001';
  end if;
  lst := jsonb_build_object('source', 'bridge ledger_list', 'at', now(), 'renamed', jsonb_build_object('from', row_name, 'to', dst, 'guid', g));
  if other_name is not null then
    -- a merge: the entries and the opening go to the row that keeps the name (and takes the GUID); the old row, now
    -- empty, is marked merged. A row with the new name marked deleted earlier is un-marked: Tally uses the name again
    moved := public.tally_ledger_carry(p_book, row_name, dst);
    select open, open_sent into o_open, o_sent from tally_ledgers where book_id = p_book and name = row_name;
    update tally_ledgers set open = coalesce(open, 0) + coalesce(o_open, 0),
           open_sent = case when open_sent is null and o_sent is null then null else coalesce(open_sent, open, 0) + coalesce(o_sent, o_open, 0) end
     where book_id = p_book and name = dst;
    if other_gone then
      perform set_config('fincom.ledger_list', jsonb_build_object('unreason', format('named again in Tally (%s renamed to it)', row_name), 'list', lst)::text, true);
      update tally_ledgers set deleted_at = null where book_id = p_book and name = dst;
    end if;
    update tally_ledgers set open = 0, open_sent = case when open_sent is null then null else 0 end, renamed_at = null where book_id = p_book and name = row_name;
    perform set_config('fincom.ledger_list', jsonb_build_object('reason', format('renamed in Tally to %s (merged into the row with that name)', dst), 'list', lst)::text, true);
    update tally_ledgers set deleted_at = now() where book_id = p_book and name = row_name;
    perform set_config('fincom.ledger_list', '', true);
    select deleted_at is null into kept from tally_ledgers where book_id = p_book and name = row_name;
    if kept then
      select public.tally_ledger_hold_reason(l) into why from tally_ledgers l where l.book_id = p_book and l.name = row_name;
      raise exception 'rename % -> %: the old row is kept live by the guard (%); the merge was rolled back', row_name, dst, coalesce(why, 'unknown reason') using errcode = 'P0001';
    end if;
    update tally_ledgers set tally_guid = null where book_id = p_book and name = row_name;
    if g is not null and other_guid is null then update tally_ledgers set tally_guid = g where book_id = p_book and name = dst; end if;
    -- migration 39: the saved choices keyed by the old name follow (map items, flow choices, choice values); the row that
    -- stays is flagged for the owner to confirm (needs_confirm; the renamed entry carries confirm: true)
    carried := public.tally_ledger_carry_choices(p_book, row_name, dst);
    update tally_ledgers set needs_confirm = true where book_id = p_book and name = dst;
    if hist then
      execute 'update tally_ledgers set before_clean = coalesce(before_clean, ''{}''::jsonb) || jsonb_build_object(''renamed'', coalesce(before_clean->''renamed'', ''[]''::jsonb) || $1) where book_id = $2 and name = $3'
        using jsonb_build_object('from', row_name, 'to', dst, 'at', now(), 'merged', true, 'guid', g, 'open', o_open, 'moved', moved, 'carried', carried), p_book, row_name;
      -- on the row that stays: what came in (under 'merged', not 'renamed': the merged name is not an old name of this row),
      -- and a 'renamed' entry to confirm (confirm: true; the owner clears it with tally_ledger_rename_confirm)
      execute 'update tally_ledgers set before_clean = coalesce(before_clean, ''{}''::jsonb) || jsonb_build_object(''merged'', coalesce(before_clean->''merged'', ''[]''::jsonb) || $1, ''renamed'', coalesce(before_clean->''renamed'', ''[]''::jsonb) || $4) where book_id = $2 and name = $3'
        using jsonb_build_object('from', row_name, 'at', now(), 'guid', g, 'open', o_open, 'moved', moved, 'carried', carried), p_book, dst,
              jsonb_build_object('mergedFrom', row_name, 'at', now(), 'confirm', true, 'carried', carried);
    end if;
  else
    -- a plain rename: the row keeps everything under the new name; its entries follow
    update tally_ledgers set name = dst, tally_guid = coalesce(tally_guid, g), renamed_at = now(), needs_confirm = true where book_id = p_book and name = row_name;
    moved := public.tally_ledger_carry(p_book, row_name, dst);
    carried := public.tally_ledger_carry_choices(p_book, row_name, dst);      -- migration 39: the saved choices follow the name
    if hist then
      execute 'update tally_ledgers set before_clean = coalesce(before_clean, ''{}''::jsonb) || jsonb_build_object(''renamed'', coalesce(before_clean->''renamed'', ''[]''::jsonb) || $1) where book_id = $2 and name = $3'
        using jsonb_build_object('from', row_name, 'at', now(), 'moved', moved, 'confirm', true, 'carried', carried), p_book, dst;
    end if;
  end if;
  -- the trial balance after: the same sum, and 0; else everything above is rolled back
  select round(coalesce(sum(closing), 0), 2) into tb_after from tally_balances where book_id = p_book;
  if tb_after <> tb_before or tb_after <> 0 then
    raise exception 'the trial balance would not tie after the rename % -> %: before %, after %; nothing was changed', row_name, dst, tb_before, tb_after using errcode = 'P0001';
  end if;
  if other_name is not null then
    return jsonb_build_object('ok', true, 'renamed', false, 'merged', true, 'from', row_name, 'to', dst, 'tb', tb_after,
      'note', format('%s -> %s: the entries and the opening carried to the row with the new name, which takes the GUID; the old row marked merged', row_name, dst)
        || case when jsonb_array_length(coalesce(carried->'clash', '[]'::jsonb)) > 0 then format('; both names had saved choices (%s): the new name''s stand, the old ones are marked carried', carried->>'clash') else '' end) || moved || jsonb_build_object('carried', carried, 'confirm', true);
  end if;
  return jsonb_build_object('ok', true, 'renamed', true, 'from', row_name, 'to', dst, 'guid', coalesce(row_guid, g), 'tb', tb_after) || moved || jsonb_build_object('carried', carried, 'confirm', true);
end $function$;

-- the owner confirms a rename seen on the Tally / ledgers page: needs_confirm cleared, each confirm: true entry of
-- before_clean.renamed[] closed with who and when
create or replace function public.tally_ledger_rename_confirm(p_book uuid, p_name text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $function$
declare f uuid := my_firm(); nm text := left(btrim(coalesce(p_name, '')), 300); hist jsonb; n int := 0;
begin
  if f is null or not exists (select 1 from members m where m.user_id = auth.uid() and m.firm_id = f and m.role = 'owner' and coalesce(m.active, true))
    then raise exception 'only an owner of the firm can confirm a rename' using errcode = '42501'; end if;
  if not exists (select 1 from tally_books where book_id = p_book and firm_id = f) then raise exception 'this company is not in your firm (or not found)'; end if;
  if nm = '' then raise exception 'which ledger? give its name'; end if;
  select coalesce(before_clean, '{}'::jsonb) into hist from tally_ledgers where book_id = p_book and name = nm;
  if hist is null then raise exception 'no such ledger: %', nm; end if;
  select coalesce(jsonb_agg(case when tally_post_bool(x->>'confirm') then x || jsonb_build_object('confirm', false, 'confirmedBy', auth.uid(), 'confirmedAt', now()) else x end), '[]'::jsonb),
         count(*) filter (where tally_post_bool(x->>'confirm')) into hist, n
    from jsonb_array_elements(coalesce(hist->'renamed', '[]'::jsonb)) x;
  update tally_ledgers set needs_confirm = false, before_clean = coalesce(before_clean, '{}'::jsonb) || jsonb_build_object('renamed', hist) where book_id = p_book and name = nm;
  return jsonb_build_object('ok', true, 'name', nm, 'cleared', n, 'by', auth.uid(), 'at', now());
end $function$;
revoke all on function public.tally_ledger_rename_confirm(uuid, text) from public, anon;
grant execute on function public.tally_ledger_rename_confirm(uuid, text) to authenticated;

-- ---------------------------------------------------------------- 2. tally_ingest_day: an empty day the bridge vouches for
create or replace function public.tally_ingest_day(p_book uuid, p_day date, p_vouchers jsonb, p_lines jsonb, p_n integer, p_alter bigint, p_bytes integer, p_empty boolean)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $function$
declare touched date[]; f uuid; sent text[]; marked int := 0; n_in int := case when jsonb_typeof(p_vouchers) = 'array' then jsonb_array_length(p_vouchers) else 0 end; short text; emptied boolean := false;
begin
  if auth.role() <> 'service_role' then raise exception 'not allowed' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(hashtext(p_book::text));
  select firm_id into f from tally_books where book_id = p_book;
  if f is null then raise exception 'no such book'; end if;
  select coalesce(array_agg(distinct x->>'guid'), '{}') into sent from jsonb_array_elements(p_vouchers) x where coalesce(x->>'guid', '') <> '';
  select array_agg(distinct d) into touched from (
    select p_day as d
    union select v.day from tally_vouchers v where v.book_id = p_book and v.guid = any(sent)
  ) q;
  -- 8: the lines these entries hold now go on their current version rows before anything is replaced
  perform tally_voucher_version_lines(p_book, array(select v.guid from tally_vouchers v where v.book_id = p_book and (v.day = p_day or v.guid = any(sent))));
  -- the entries in the file: inserted, or brought up to date in place (deleted_at cleared); a version row for each AlterID
  insert into tally_vouchers (book_id, firm_id, guid, day, alter_id, vtype, vno, party, narration, cancelled, optional, gstin, pos, ref, ref_date, cmp_gstin, fincom_id, deleted_at)
  select distinct on (x->>'guid') p_book, f, x->>'guid', p_day, coalesce((x->>'alter')::bigint, 0), coalesce(x->>'type', ''), coalesce(x->>'no', ''),
         tally_nm(x->>'party'), left(coalesce(x->>'narr', ''), 300), coalesce((x->>'cancel')::boolean, false), coalesce((x->>'opt')::boolean, false),
         left(upper(coalesce(x->>'gstin', '')), 15), left(coalesce(x->>'pos', ''), 60),
         left(coalesce(x->>'ref', ''), 60), tally_d8(x->>'refDate'), left(upper(coalesce(x->>'cmp', '')), 15),
         case when coalesce(x->>'fid', '') ~ '^[A-Za-z0-9._-]{1,80}$' then x->>'fid' end, null
    from jsonb_array_elements(p_vouchers) x
   order by x->>'guid', coalesce((x->>'alter')::bigint, 0) desc
  on conflict (book_id, guid) do update set
     day = excluded.day, alter_id = excluded.alter_id, vtype = excluded.vtype, vno = excluded.vno, party = excluded.party, narration = excluded.narration,
     cancelled = excluded.cancelled, optional = excluded.optional, gstin = excluded.gstin, pos = excluded.pos, ref = excluded.ref, ref_date = excluded.ref_date,
     cmp_gstin = excluded.cmp_gstin, deleted_at = null,
     fincom_id = coalesce(excluded.fincom_id, substring(excluded.narration from 'TDSDesk:([A-Za-z0-9._-]+)'), tally_vouchers.fincom_id),
     origin = case when excluded.fincom_id is not null or excluded.narration ~ 'TDSDesk:[A-Za-z0-9]' then 'fincom' else tally_vouchers.origin end;
  insert into tally_voucher_versions (book_id, firm_id, tally_guid, alter_id, payload)
  select v.book_id, v.firm_id, v.guid, coalesce(v.alter_id, 0), to_jsonb(v) from tally_vouchers v where v.book_id = p_book and v.guid = any(sent)
  on conflict (book_id, tally_guid, alter_id) do nothing;
  -- the day's entries not in the file: marked, kept (lines and bills kept too) - but NEVER on a short read (migration 38,
  -- item 9): a file with no entries, or fewer than the bridge counted for the day (p_n), upserts what came and marks
  -- nothing; the answer says refused: 'short read: n of p_n' and tally-ingest logs it
  if n_in = 0 and coalesce(p_n, 0) = 0 and p_empty is true then
    -- migration 39: the bridge positively read the day and Tally listed no entries: the day's live entries are marked
    -- deleted (soft, kept with their lines and bills; a later file with entries un-marks them)
    update tally_vouchers v set deleted_at = now() where v.book_id = p_book and v.day = p_day and v.deleted_at is null;
    get diagnostics marked = row_count; emptied := true;
  elsif n_in = 0 or n_in < coalesce(p_n, 0) then
    short := format('short read: %s of %s', n_in, coalesce(p_n, 0));
  else
    update tally_vouchers v set deleted_at = now() where v.book_id = p_book and v.day = p_day and v.deleted_at is null and not (v.guid = any(sent));
    get diagnostics marked = row_count;
  end if;
  -- a re-sent entry's lines and bills are replaced (its old ones are on its old version row)
  delete from tally_bills b where b.book_id = p_book and b.guid = any(sent);
  delete from tally_lines l where l.book_id = p_book and l.guid = any(sent);
  insert into tally_lines (book_id, firm_id, guid, day, ledger, amount, hsn, rate)
  select p_book, f, x->>0, p_day, tally_nm(x->>1), (x->>2)::numeric, left(coalesce(x->>3, ''), 20), nullif(x->>4, '')::numeric from jsonb_array_elements(p_lines) x;
  insert into tally_bills (book_id, firm_id, guid, day, ledger, name, type, amount, bill_date, credit_days, due)
  select p_book, f, x->>0, p_day, tally_nm(x->>1), left(coalesce(b->>0, ''), 200), left(coalesce(b->>1, ''), 20), (b->>2)::numeric,
         case when b->>1 in ('New Ref', 'Advance') then p_day end,
         nullif(b->>3, '')::integer,
         case when b->>1 = 'New Ref' and nullif(b->>3, '') is not null then p_day + (b->>3)::integer end
    from jsonb_array_elements(p_lines) x, jsonb_array_elements(case when jsonb_typeof(x->5) = 'array' then x->5 else '[]'::jsonb end) b
   where coalesce(b->>2, '') <> '';
  perform tally_voucher_version_lines(p_book, sent);
  -- the day cache, from live entries only
  delete from tally_ledger_day t where t.book_id = p_book and t.day = any(touched);
  insert into tally_ledger_day (book_id, firm_id, ledger, day, amount, dr, cr, n)
  select p_book, f, l.ledger, l.day, sum(l.amount), sum(case when l.amount < 0 then -l.amount else 0 end), sum(case when l.amount > 0 then l.amount else 0 end), count(*)
    from tally_lines l join tally_vouchers v on v.book_id = l.book_id and v.guid = l.guid
   where l.book_id = p_book and l.day = any(touched) and v.deleted_at is null and not v.cancelled and not v.optional
   group by l.ledger, l.day;
  insert into tally_days (book_id, firm_id, day, n, alter_max, bytes, at) values (p_book, f, p_day, p_n, p_alter, p_bytes, now())
  on conflict (book_id, day) do update set n = excluded.n, alter_max = excluded.alter_max, bytes = excluded.bytes, at = now();
  update tally_books set days_at = now() where book_id = p_book;
  return jsonb_build_object('ok', true, 'day', p_day, 'touched', to_jsonb(touched), 'marked', marked, 'sent', coalesce(array_length(sent, 1), 0)) || case when short is null then '{}'::jsonb else jsonb_build_object('refused', short) end || case when emptied then jsonb_build_object('empty', true) else '{}'::jsonb end;
end $function$;
-- the 7-argument call (tally-ingest before this migration, the re-read of kept files): no word on emptiness
create or replace function public.tally_ingest_day(p_book uuid, p_day date, p_vouchers jsonb, p_lines jsonb, p_n integer, p_alter bigint, p_bytes integer)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $function$
begin
  return public.tally_ingest_day(p_book, p_day, p_vouchers, p_lines, p_n, p_alter, p_bytes, null::boolean);
end $function$;
revoke all on function public.tally_ingest_day(uuid, date, jsonb, jsonb, integer, bigint, integer, boolean), public.tally_ingest_day(uuid, date, jsonb, jsonb, integer, bigint, integer) from public, anon, authenticated;
grant execute on function public.tally_ingest_day(uuid, date, jsonb, jsonb, integer, bigint, integer, boolean), public.tally_ingest_day(uuid, date, jsonb, jsonb, integer, bigint, integer) to service_role;

-- ---------------------------------------------------------------- 3. tally_post_ids_sync: a confirmed or ok entry keeps its id live
create or replace function public.tally_post_ids_sync() returns trigger language plpgsql security definer set search_path = public, pg_temp as $function$
declare acc text[];
begin
  if tg_op = 'INSERT' then
    insert into tally_post_ids (firm_id, client_id, fincom_id, job_id, entry_id, live)
    select distinct on (tally_fincom_id(v)) new.firm_id, new.client_id, tally_fincom_id(v), new.id, v->>'id', new.status not in ('failed', 'cancelled')
      from jsonb_array_elements(coalesce(new.payload->'vouchers', '[]'::jsonb)) v where tally_fincom_id(v) is not null;
  elsif new.status is distinct from old.status then
    -- failed or cancelled: the ids may be queued again; waiting again (Retry): live again, unless another posting has them.
    -- An id Tally accepted is never freed here: stamped (accepted_at, 36b), said by the posting's own results / items as
    -- accepted and not confirmed (tally_post_job_accepted, 38), or confirmed / ok in a result or item (39); a released id
    -- is never revived
    select coalesce(array_agg(distinct id), '{}') into acc from (
      select unnest(string_to_array(coalesce(tally_post_job_accepted(new.id, new.results, new.items), ''), ', ')) id
      union select x->>'id' from jsonb_array_elements(coalesce(new.results, '[]'::jsonb)) x where x->>'id' is not null and (tally_post_result_confirmed(x) or tally_post_bool(x->>'ok'))
      union select x->>'id' from jsonb_array_elements(coalesce(new.items, '[]'::jsonb)) x where x->>'id' is not null and tally_post_result_confirmed(x)) s where id <> '';
    update tally_post_ids i set live = (i.accepted_at is not null and i.released_at is null)
        or (new.status not in ('failed', 'cancelled') and i.released_at is null)
        or (i.released_at is null and exists (select 1 from unnest(acc) a where tally_post_id_match(i.fincom_id, i.entry_id, a)))
     where i.job_id = new.id;
  end if;
  return new;
exception when unique_violation then
  raise exception 'This bill is already being posted to Tally in another posting (its FinCom id is taken); wait for that posting to finish.' using errcode = '23505';
end $function$;
revoke all on function public.tally_post_ids_sync() from public, anon, authenticated;

commit;
