create or replace function public.tally_selfcheck_words(p_result text, p_ran_at timestamptz, p_night date, p_since date, p_listed integer, p_missing integer,
  p_fetched integer, p_still integer, p_deleted integer, p_masters bigint, p_stopped text, p_fetch_off text, p_gap date[], p_copy jsonb, p_x jsonb)
returns text language plpgsql stable security definer set search_path = public, pg_temp as $function$
declare w text; hm text := to_char(p_ran_at at time zone 'Asia/Kolkata', 'HH24:MI'); nt text := to_char(p_night, 'DD-Mon-YYYY');
  days text := ''; probs text[] := '{}'; ent text;
  aft text := case when coalesce(p_x->>'after', '') ~ '^[0-9]{1,15}$' then p_x->>'after' end;
  alt text := case when coalesce(p_x->>'altvchid', '') ~ '^[0-9]{1,15}$' then p_x->>'altvchid' end;
  sf date := case when coalesce(p_x->>'sliceFrom', '') ~ '^[0-9]{8}$' then to_date(p_x->>'sliceFrom', 'YYYYMMDD') end;
  st date := case when coalesce(p_x->>'sliceTo', '') ~ '^[0-9]{8}$' then to_date(p_x->>'sliceTo', 'YYYYMMDD') end;
  what text;
begin
  -- what is checked, exactly: the entries that exist in Tally above the change number checked from (of a month slice: its dates)
  what := 'every entry' || case when sf is not null and st is not null then ' dated ' || to_char(sf, 'DD-Mon-YYYY') || ' to ' || to_char(st, 'DD-Mon-YYYY') else '' end
    || ' that exists in Tally with a change number above ' || coalesce(aft, 'the last check''s');
  if coalesce(array_length(p_gap, 1), 0) > 0 then
    select string_agg(to_char(d, 'DD-Mon-YYYY'), ', ' order by d) into days from (select distinct d from unnest(p_gap) d order by d limit 31) g;
    if array_length(p_gap, 1) > 31 then days := days || ' and later days'; end if;
  end if;
  if p_result = 'not_checked' then
    return 'Not checked on the night of ' || nt || ' (' || hm || ' IST): ' || coalesce(nullif(p_stopped, ''), 'Tally could not be asked') || '. Upload the Day Book '
      || case when p_since is not null then 'from ' || to_char(p_since, 'DD-Mon-YYYY') || ' to today' else 'for the days worked on since the starting point' end
      || ' to be sure nothing is missing.';
  end if;
  w := 'Checked on the night of ' || nt || ' at ' || hm || ' IST: ';
  ent := case when p_missing = 1 then ' entry' else ' entries' end;
  if p_missing = 0 then
    w := w || case when p_listed = 0 and sf is null and alt is not null and alt = aft then 'nothing changed in Tally since the last check (its change counter has not moved).'
                   when p_listed = 0 and sf is null then 'no entry that exists in Tally has a change number above ' || coalesce(aft, 'the last check''s') || '. Deletes made in Tally are not checked.'
                   else what || ' (changed since ' || coalesce('the night of ' || to_char(p_since, 'DD-Mon-YYYY'), 'the starting point') || ') is in FinCom (' || p_listed || ' checked'
                     || case when sf is not null then '; checked month by month, the rest on the next nights' else '' end || '). Deletes made in Tally are not checked.' end;
  elsif p_still = 0 then
    w := w || p_missing || ent || ' missing from FinCom; ' || case when p_fetched = 1 then 'fetched' else 'all ' || p_fetched || ' fetched' end || ' from Tally.';
  else
    w := w || p_missing || ent || ' missing from FinCom' || case when p_fetched > 0 then '; ' || p_fetched || ' fetched from Tally, ' || p_still || ' still missing' else '' end
      || case when p_fetch_off <> '' then ' (entries are not fetched for this company now: ' || p_fetch_off || ')' else '' end
      || case when days <> '' then ': upload the Day Book for ' || days || '.' else '.' end
      || case when p_deleted > 0 then ' ' || p_deleted || ' of them FinCom holds as deleted.' else '' end;
  end if;
  if p_masters > 0 then w := w || ' ' || p_masters || ' master change' || case when p_masters = 1 then '' else 's' end || ' in Tally not yet taken by FinCom.'; end if;
  if p_copy is not null and p_copy ? 'ok' then
    if (p_copy->>'ok')::boolean then w := w || ' FinCom''s copy adds up.';
    else
      if coalesce((p_copy->>'unbalanced')::bigint, 0) > 0 then probs := probs || ((p_copy->>'unbalanced') || ' entr' || case when (p_copy->>'unbalanced')::bigint = 1 then 'y does' else 'ies do' end || ' not add up to zero'); end if;
      if coalesce((p_copy->>'totalsOff')::bigint, 0) > 0 then probs := probs || ('the totals of ' || (p_copy->>'totalsOff') || ' ledger' || case when (p_copy->>'totalsOff')::bigint = 1 then '' else 's' end || ' differ from their entries'); end if;
      if abs(coalesce((p_copy->>'movement')::numeric, 0)) >= 0.01 then probs := probs || ('the year''s entries total Rs ' || to_char(abs((p_copy->>'movement')::numeric), 'FM999999999999990.00') || ' instead of zero'); end if;
      if abs(coalesce((p_copy->>'openings')::numeric, 0)) >= 0.01 then probs := probs || ('the openings differ by Rs ' || to_char(abs((p_copy->>'openings')::numeric), 'FM999999999999990.00') || ' (Tally''s difference in opening balances)'); end if;
      if coalesce((p_copy->>'unknownLedgers')::bigint, 0) > 0 then probs := probs || ((p_copy->>'unknownLedgers') || ' ledger' || case when (p_copy->>'unknownLedgers')::bigint = 1 then ' named by entries is' else 's named by entries are' end || ' not in the ledger list'); end if;
      w := w || ' FinCom''s copy: ' || array_to_string(probs, '; ') || '.';
    end if;
  end if;
  return w;
end $function$;