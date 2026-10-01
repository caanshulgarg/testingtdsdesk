# Tables reached only through functions (review item 23)

Four tables in `public` have row level security switched **on** and **no policies**. That is intended. With RLS on
and no policy, the app's users get no rows and cannot add or change any. The roles that can't reach the tables
directly are `anon` (not signed in) and `authenticated` (a signed-in user of any firm), even where the table still
grants them rights.

Only two kinds of code reach these tables:

- **SECURITY DEFINER functions.** Each one checks who is asking before it reads or writes.
- **The service role, from edge functions.** Each function checks the caller's sign-in first.

| Table | Holds | Reached only through |
|---|---|---|
| `drop_keys` | the secret part of each client's drop link and inbox address | `create_drop_key`, `my_drop_keys`, `revoke_drop_key`, `refresh_inbox_link`, `post_inbox` |
| `gst_sessions` | GST portal API sessions (auth tokens), a few hours each | the `gst-taxpro` edge function (service role); see `server/gst-taxpro/schema.sql` |
| `support_tickets` | tickets raised to FinCom support | `support_new`, `support_list`, `support_get`, `support_reply`, `support_set`, `support_can` |
| `support_messages` | the messages on each ticket | `support_new`, `support_get`, `support_reply`, `support_row` |

`auth_lockout` (Phase 2, item 21) works the same way. It has one policy, which is for `supabase_auth_admin` only (the
sign-in hook), so the app's users cannot reach it either.

## The check

`server/security/checks/tables-without-policies.sql` signs in as `anon` and then as `authenticated`. It tries to read
and to insert into each table, and first reads the catalog: RLS on, and no policy that lets those roles in. The check
keeps nothing, because it ends by raising an error that undoes everything it did.

Result on staging (`tds-desk-staging`), 01-Oct-2026:

```
drop_keys: RLS on, 0 policies for anon or authenticated
gst_sessions: RLS on, 0 policies for anon or authenticated
support_tickets: RLS on, 0 policies for anon or authenticated
support_messages: RLS on, 0 policies for anon or authenticated
anon drop_keys: 0 rows, insert refused (42501)
anon gst_sessions: no select right, insert refused (42501)
anon support_tickets: 0 rows, insert refused (42501)
anon support_messages: 0 rows, insert refused (42501)
authenticated drop_keys: 0 rows, insert refused (42501)
authenticated gst_sessions: no select right, insert refused (42501)
authenticated support_tickets: 0 rows, insert refused (42501)
authenticated support_messages: 0 rows, insert refused (42501)
```

Run it again after any change to these tables or their grants. Any line other than `0 rows` / `no select right` and
`insert refused` means a policy or grant has opened the table, and the change must be looked at before it goes live.

**Not done, offered:** `drop_keys`, `support_tickets` and `support_messages` still *grant* select, insert, update and
delete to `anon` and `authenticated`. RLS blocks all of it today. Revoking those grants would make a second wall, so
that a policy added by mistake later would still not open the tables. It is not run: database security changes are
shown first.
