# Connect from the bridge (FinCom Bridge 2.3.5) — design

Status: **design only, paused** (08-Oct-2026). The owner paused the code until the new PC's log line arrives, because
its cause may change the design (last section). No code, migration or screen is written yet. Branch `next-connect`,
from `origin/next-fastfetch` (28bd6468, the 2.3.4 code).

## Why

Today a computer is connected only through the browser talking to the local bridge: the 6-digit code
(`src/js/24-tally-bridge.js` `pair()` / `probeUrl()`, `bridge-go/server.go` `/ping` `/pair`), the own-Windows-user check
(`bridge-go/ownuser.go`, `win_peer.go`: the TCP row of the asking program, its pid, its process token's SID), and the
key handed over by the page (`/cloudlink` from `src/js/49-tally-cloud.js` `auto()` / `autoOwn()`, after
`tally_device_create`). On the new PC the bridge answered `"yours": false` to the user's own browser, so nothing could
connect, and nothing said why. The new flow removes the browser-to-bridge step: the bridge talks to the cloud, the person
approves in FinCom, the bridge collects its key from the cloud.

## 1. The flow

1. **Start (bridge).** Tray item **"Connect to FinCom…"** (and offered as the last step of setup). The bridge makes a
   fresh random secret `S` (32 bytes, crypto/rand), keeps it in memory only (never in the log or config), and calls
   tally-ingest **without a key** (no `x-fincom-device` header) with
   `{kind: "connect_start", bridgeId, computer, winUser, winSid, version, secretHash: sha256(S)}`.
   - `winUser` / `winSid`: the bridge's **own** Windows user, from its own process token
     (`windows.GetCurrentProcessToken().GetTokenUser()`, the lookup proven on every Windows runner in run 37745636155).
     Under the Windows service (SYSTEM) it is the owner it works for (`OwnerSid`, already in config), never the
     browser's user and never SYSTEM.
2. **Cloud answers** `{ok, token, code, expiresAt}`: a one-time `token` (32 random bytes, base64url, 256 bits) and a
   short fallback `code` (8 characters from `23456789ABCDEFGHJKMNPQRSTUVWXYZ`, shown `ABCD-EFGH`). Only
   `sha256(token)`, `sha256(code)` and `sha256(S)` are stored. Nothing about any firm is returned.
3. **Browser.** The bridge opens the default browser at
   `https://<staging site>/review/#/connect?t=<token>` (the live site later). If it cannot open a browser, the tray shows
   the code (section 4).
4. **Connect page** (new screen `app/src/screens/Connect.jsx`). Signed out: sign in first, then back to the same page
   (token kept only in the URL fragment, never sent to a server log). Signed in: the page calls
   `tally_connect_look(p_token)` (marks the request **opened**) and shows the computer and Windows user the bridge sent,
   with the member's firm. The member may approve when they are the firm's owner or a member with `can_write()` (the
   same rule as `tally_device_create` today).
5. **Connect** → `tally_connect_approve(p_token)` (or `p_code`): marks the request **approved** with the approver,
   their firm and time, and answers `{ok, computer, winUser}`. **No key exists yet**: the key is made at delivery
   (step 6), so no key, sealed or plain, is ever at rest. **Not me** → `tally_connect_refuse(p_token)`: the request is
   closed, nothing made.
6. **Poll (bridge).** Every 3 s while the window is open (10 minutes at most), no key header:
   `{kind: "connect_poll", requestId, secret: S}`. The cloud compares `sha256(S)` to the stored hash in constant time.
   - pending → `{ok: true, state: "waiting"}`;
   - approved → `tally_connect_deliver` (service role, one transaction, `... where state = 'approved' returning`):
     creates or replaces the binding for `(firm, computer, winSid)` (section 6), makes the key `fcd_` + 48 hex (as
     `tally_device_create`, `created_by` = the approver), stores only its hash in `tally_devices`, marks the row
     **delivered**, and the answer `{ok: true, state: "approved", url, key, firm, device}` carries the key **once**;
   - refused / expired / delivered / wrong secret → `{ok: false, state, error: <plain words>}` and the bridge stops.
7. **Store (bridge).** Exactly what `/cloudlink` does today: `setCloudLink({url, key})` (url checked against FinCom's
   two clouds, key `^fcd_[0-9a-f]{48}$`, DPAPI-protected `CloudKeyGo`, `own_key` move when an old key is held, `hello`).
   Tray: **"Connected to FinCom"**.

The old 6-digit browser pairing stays as it is, for older bridges (nothing removed).

## 2. One-time token bound to the asking bridge

- The key is handed out only by `connect_poll` with the secret whose hash `connect_start` stored. A person who sees the
  token or code (e.g. over a shoulder) can at most approve the request; the key still goes only to the bridge holding
  `S`.
- The token and code are single use: approve and refuse move the row out of `pending` with
  `update ... where state in ('pending','opened') returning`; a second approve answers "This request was already
  answered." A poll after `delivered` answers "This computer has already collected its key."
- Approve also requires the row's `firm_id` to be null or the approver's firm (a request approved by firm A cannot be
  re-approved by firm B).

## 3. Ten-minute validity

`expires_at = started_at + 10 minutes` for token and code alike. Every RPC and poll checks `now() < expires_at` first; an
expired row is marked `expired` on first touch (an approved but uncollected request expires too: no key was made). Words:
**"This connect request has expired (they last 10 minutes). Start again from the FinCom Bridge tray icon: Connect to
FinCom…"**

## 4. Fallback code

- When the browser does not open, or FinCom is used on another computer, the tray shows:
  **"To connect, open FinCom on any computer, go to Tally → Connect a computer → Enter code, and type ABCD-EFGH. The code
  works for 10 minutes."**
- FinCom's Tally page: **"Connect a computer"** → **"Enter code"** → the same confirmation as the token page →
  `tally_connect_approve(p_code => ...)`.
- Rate limit: at most **5 wrong codes per firm per 10 minutes** (counted from the attempts table); the 6th answers
  **"Too many wrong codes. Wait 10 minutes, then try again."** and is recorded too. Each wrong code is recorded with the
  member who typed it.

## 5. Every attempt recorded — migration 67 (`migration-67-connect-from-bridge.sql`)

Number 67 is free (62-66 and 69 are taken on other branches; 61 too; checked across all branches 08-Oct). Add-only, one
transaction, `set local lock_timeout = '10s'`, safe twice, no `delete from`.

```sql
create table if not exists public.tally_connect_requests (
  id            uuid primary key default gen_random_uuid(),
  token_hash    text not null unique,          -- sha256(token), hex
  code_hash     text not null unique,          -- sha256(code), hex
  secret_hash   text not null,                 -- sha256(bridge secret), hex
  bridge_id     text not null,                 -- "go-…"
  computer      text not null,
  win_user      text not null,
  win_sid       text not null,                 -- S-1-5-21-…
  version       text,
  ip            inet,
  state         text not null default 'pending'
                check (state in ('pending','opened','approved','refused','expired','delivered')),
  started_at    timestamptz not null default now(),
  expires_at    timestamptz not null,
  firm_id       uuid references public.firms(id) on delete cascade,   -- null until approved / refused by a member
  answered_by   uuid,
  answered_at   timestamptz,
  device_id     uuid references public.tally_devices(id) on delete set null,
  delivered_at  timestamptz
);
create table if not exists public.tally_connect_attempts (
  id          bigserial primary key,
  request_id  uuid references public.tally_connect_requests(id) on delete set null,
  firm_id     uuid references public.firms(id) on delete cascade,     -- null while unbound
  at          timestamptz not null default now(),
  what        text not null check (what in ('started','opened','approved','refused','expired',
                                            'wrong_code','too_many_codes','delivered','poll_refused')),
  by_user     uuid,
  bridge_id   text, computer text, win_user text, version text,
  reason      text
);
create table if not exists public.tally_device_bindings (   -- one per (firm, computer, Windows user SID)
  firm_id     uuid not null references public.firms(id) on delete cascade,
  computer    text not null,
  win_sid     text not null,
  win_user    text not null,
  device_id   uuid not null references public.tally_devices(id),
  bridge_id   text,
  bound_at    timestamptz not null default now(),
  bound_by    uuid,
  primary key (firm_id, computer, win_sid)
);
```

- RLS on all three. `tally_connect_attempts` and `tally_device_bindings`: `select` for authenticated where
  `firm_id = my_firm()` (rows with a null firm are never readable). `tally_connect_requests`: no direct select for
  anyone (column grants exclude every hash); pending requests are readable only through
  `tally_connect_look(p_token)` / `(p_code)`, which return computer, Windows user, version, state and expiry only.
- Functions (security definer, `search_path = public, extensions, pg_temp`):
  `tally_connect_start(...)`, `tally_connect_poll(id, secret)` and `tally_connect_deliver(id)` granted to the **service role only** (tally-ingest);
  `tally_connect_look(text, text)`, `tally_connect_approve(text, text)`, `tally_connect_refuse(text)` and
  `tally_connect_attempts_list()` to authenticated; all revoked from public and anon.
- Shown on the Tally page: **"Connection attempts"**, the last 20 rows: time, computer, Windows user, what happened,
  by whom, reason. New component `app/src/parts/ConnectAttempts.jsx`. **Tally.jsx should mount** `<ConnectAttempts/>`
  under the computers list, and the **"Connect a computer"** button (with "Enter code") beside it; the route
  `#/connect` goes to `app/src/screens/Connect.jsx` (registered in `app/src/screens/index.js`).

## 6. Separate binding per Windows user

- One binding per `(firm, computer, winSid)` in `tally_device_bindings`; each binding has its own `tally_devices` row
  (named `"<PC> · <Windows user>"`, as 2.3.0's keys) and key.
- A second Windows user on the same PC connects from its own bridge (its own tray) and gets its own binding and key.
- Reconnecting the same user: at delivery the new key's device replaces the binding's `device_id`; the old device is revoked
  softly (`revoked = true`, as `tally_device_revoke` does; nothing deleted). Its bridge id is moved to the new key in
  `tally_bridge_ids` by the approve (the approve is the proof the old flow got from `own_key`), so the bridge's
  postings and member link follow it; when the bridge still holds the old key, `setCloudLink`'s `own_key` move does the
  same and is harmless twice.
- The SID is the bridge's own (section 1.1), never read from the browser.

## 7. Security limits

- `connect_start` is unauthenticated. Caps: at most **3 pending requests per bridge id** and **10 per IP** in any
  10 minutes (the IP from `x-forwarded-for`'s first entry, as the edge gives it); above that: **"Too many connect
  requests from this computer. Wait 10 minutes, then try again."** Body capped at 4 KB; every field length-checked
  (computer, user ≤ 80, SID `^S-1-5-21(-\d+){1,8}$`, bridge id `^go-[0-9a-f]{6,32}$`, version `^\d+\.\d+\.\d+$`).
- No firm data before approval: start and poll answer only state words; look answers only what the bridge itself sent.
- Entropy: token 256 bits; code 8 of 31 symbols ≈ 39.6 bits, with 5 wrong tries per firm per 10 minutes and a 10-minute
  life (and an attacker must also be a signed-in member of the firm to try codes at all).
- Constant-time compares of the hashes (`timingSafeEqual` in Deno; lookups by hash in SQL index). Hashes only at rest;
  the key is made at delivery and exists only in that one answer and on the bridge.
- No AI in the bridge; no request to Tally added or changed.

## 8. The small items for the same branch (also paused)

- `/ping` answering `"yours": false` logs the reason with the peer pid and program, at most once a minute
  (`"Answered not-yours to pid 1234 (chrome.exe): <reason>"`). Today nothing is logged for `/ping`.
- `peerPidFrom` (`bridge-go/ownuser.go`) takes only an **established** row (`State == 5`) with a **non-zero pid**
  (today any row with the matching ports, including TIME_WAIT rows with pid 0, may win).

## 9. Tests planned (test-first, each red then green)

- Go, against a stand cloud: start; poll before approve waits; approve; key delivered once; second poll refused;
  expiry; wrong secret refused; per-user binding (two SIDs, two keys; same SID again replaces). Windows job
  (`bridge-windows.yml`) for the tray item and the token-user lookup.
- Deno server tests for `connect_start` / `connect_poll` (pattern of `tests/run_main_bridge_server.py`,
  `run_bridge_control_server.py`): caps per IP and bridge, no firm data before approval.
- `pg_stand` migration test run twice (`tests/run_migration67.py`) and `run_migration_order.py` with 67 added.
- Playwright (`app/dist-test`, under `flock /tmp/fincom-app.lock`): the Connect page (Connect, Not me, expired, signed
  out), the code entry, the 6th wrong code, the attempts list.

## 10. The exact UI words

| Where | Words |
|---|---|
| Tray item | Connect to FinCom… |
| Tray, end of setup | Connect this computer to FinCom now? |
| Tray, waiting | Waiting for you to approve in FinCom… (the browser opened; code ABCD-EFGH if it did not) |
| Tray, done | Connected to FinCom |
| Tray, fallback | To connect, open FinCom on any computer, go to Tally → Connect a computer → Enter code, and type ABCD-EFGH. The code works for 10 minutes. |
| Connect page title | Connect this computer |
| Connect page question | Connect computer **<PC>**, Windows user **<user>**, to **<firm>**? |
| Buttons | Connect · Not me |
| After Connect | Connected. FinCom Bridge on <PC> (<user>) will finish by itself in a few seconds. |
| After Not me | Not connected. Nothing was made; this request is closed. |
| Not allowed | Only the firm's owner, or a member who may make changes, can connect a computer. |
| Expired | This connect request has expired (they last 10 minutes). Start again from the FinCom Bridge tray icon: Connect to FinCom… |
| Already answered | This request was already answered. |
| Already collected | This computer has already collected its key. |
| Wrong code | That code is not right, or it has expired. |
| Too many codes | Too many wrong codes. Wait 10 minutes, then try again. |
| Too many starts | Too many connect requests from this computer. Wait 10 minutes, then try again. |
| Tally page | Connect a computer · Enter code · Connection attempts |

## 11. Depends on the new PC's cause

The new PC's bridge answered `"yours": false` to its user's own browser. Which parts change depends on why:

**(a) Another Windows user's bridge holds the port** (a second user's bridge, or the service under another owner,
answering on 127.0.0.1:port, so the browser talks to a bridge that is not its user's).
- The flow stands and is the fix: each user's own bridge connects itself, bound by its own SID (section 6), with no
  port or browser involved. Add: the tray of a bridge that is **not** listening on the agreed port says so
  ("Another Windows user's FinCom Bridge is answering on this computer…") and the connect flow is offered there.
- The per-user binding and the `tally_bridge_ids` move become essential, not optional; test two SIDs on one PC first.

**(b) Security software between browser and bridge** (a proxy or web filter on loopback, so the connection's peer is
the security program, not the browser).
- The flow stands unchanged (the bridge goes out over HTTPS to the cloud, which such software allows) and becomes the
  main path; the browser pairing stays a fallback.
- The bridge's cloud call must then survive the same software: TLS through a system proxy (use the system proxy
  settings, `http.ProxyFromEnvironment` plus WinINET's), and the stand cloud test adds a proxy.
- The `/ping` log line (section 8) should name the peer program so support sees the filter by name.

**(c) The peer-row lookup is wrong** (`peerPidFrom` picks a TIME_WAIT or listening row with pid 0, or another
connection's row, so the browser's own process is never found).
- Then the old flow is simply buggy and section 8's fix (established rows only, non-zero pid) may be the whole cure;
  the connect flow becomes an improvement rather than an urgent fix and could follow in a later release.
- Add a test with the new PC's real TCP table rows (once captured) and run the Windows job against it.
- Section 1 is unaffected: it uses the bridge's own process token, not the peer lookup.

In all three cases sections 2-7 (one-time token, 10 minutes, fallback code, attempts table, security limits) stay the
same; what changes is mainly the priority, the tray's words, and (b)'s proxy handling.
