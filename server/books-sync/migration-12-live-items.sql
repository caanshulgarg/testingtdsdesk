-- Live sync, review of 01-Oct-2026 (branch server-books): a client's TDS and GST work kept item by item, not as one
-- blob per client, and changes sent to every open computer at once (Supabase Realtime).
--   client_book_items          one row per item of a client's books: a TDS/GST ledger's mapping (key "map", item the
--                              ledger's name), a challan (key "challans", item its id), and so on; item '' holds a value
--                              that is not split. The latest save of an item wins; nothing else is touched by it.
--   client_book_items_history  what each save replaced (nothing is lost)
--   save_book_items(client, items)   saves items for the caller's firm (owners and staff); returns each item's seq
--   supabase_realtime          + client_book_items, records, clients: each change is sent to the firm's open computers;
--                              Realtime checks the same read policies, so a computer only hears of its own firm's rows
-- Adds only. client_books (the old blob) stays as it is and is read once to fill the items. Nothing is dropped or deleted.

begin;

create sequence if not exists public.book_item_seq;

create table if not exists public.client_book_items (
  firm_id    uuid not null references public.firms(id),
  client_id  text not null,
  key        text not null,
  item       text not null default '',
  ord        integer,
  data       jsonb,
  deleted    boolean not null default false,
  seq        bigint not null default nextval('public.book_item_seq'),
  updated_at timestamptz not null default now(),
  updated_by uuid,
  primary key (firm_id, client_id, key, item)
);
create index if not exists client_book_items_seq on public.client_book_items (firm_id, client_id, seq);

create table if not exists public.client_book_items_history (
  id          bigserial primary key,
  firm_id     uuid not null,
  client_id   text not null,
  key         text not null,
  item        text not null,
  data        jsonb,
  deleted     boolean,
  seq         bigint,
  saved_at    timestamptz,
  saved_by    uuid,
  replaced_at timestamptz not null default now(),
  replaced_by uuid
);
create index if not exists client_book_items_history_item on public.client_book_items_history (firm_id, client_id, key, item);

alter table public.client_book_items enable row level security;
alter table public.client_book_items_history enable row level security;
drop policy if exists client_book_items_read on public.client_book_items;
create policy client_book_items_read on public.client_book_items for select to authenticated using ((firm_id = my_firm()) or is_superadmin());
drop policy if exists client_book_items_history_read on public.client_book_items_history;
create policy client_book_items_history_read on public.client_book_items_history for select to authenticated using ((firm_id = my_firm()) or is_superadmin());
-- read through the policies above; written only through save_book_items
revoke all on public.client_book_items, public.client_book_items_history from anon, authenticated;
grant select on public.client_book_items, public.client_book_items_history to authenticated;

create or replace function public.save_book_items(p_client text, p_items jsonb)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare f uuid := my_firm(); x jsonb; cur public.client_book_items%rowtype; s bigint; out jsonb := '[]'::jsonb;
begin
  if f is null or not can_write() then raise exception 'not allowed to save for this firm' using errcode = '42501'; end if;
  if coalesce(p_client, '') = '' or jsonb_typeof(p_items) <> 'array' then raise exception 'client and items are needed'; end if;
  if jsonb_array_length(p_items) > 2000 then raise exception 'at most 2000 items at a time'; end if;
  for x in select * from jsonb_array_elements(p_items) loop
    if coalesce(x->>'k', '') = '' or length(x->>'k') > 60 or length(coalesce(x->>'i', '')) > 300 then raise exception 'bad item'; end if;
    select * into cur from public.client_book_items where firm_id = f and client_id = p_client and key = x->>'k' and item = coalesce(x->>'i', '') for update;
    if found then
      insert into public.client_book_items_history (firm_id, client_id, key, item, data, deleted, seq, saved_at, saved_by, replaced_by)
      values (f, p_client, cur.key, cur.item, cur.data, cur.deleted, cur.seq, cur.updated_at, cur.updated_by, auth.uid());
    end if;
    s := nextval('public.book_item_seq');
    insert into public.client_book_items (firm_id, client_id, key, item, ord, data, deleted, seq, updated_at, updated_by)
    values (f, p_client, x->>'k', coalesce(x->>'i', ''), nullif(x->>'o', '')::integer, case when coalesce((x->>'del')::boolean, false) then null else x->'d' end,
            coalesce((x->>'del')::boolean, false), s, now(), auth.uid())
    on conflict (firm_id, client_id, key, item) do update
      set ord = excluded.ord, data = excluded.data, deleted = excluded.deleted, seq = excluded.seq, updated_at = excluded.updated_at, updated_by = excluded.updated_by;
    out := out || jsonb_build_object('k', x->>'k', 'i', coalesce(x->>'i', ''), 'seq', s);
  end loop;
  return jsonb_build_object('ok', true, 'items', out, 'at', now());
end $function$;
revoke all on function public.save_book_items(text, jsonb) from public, anon;
grant execute on function public.save_book_items(text, jsonb) to authenticated;

alter publication supabase_realtime add table public.client_book_items, public.records, public.clients;

commit;
