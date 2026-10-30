# Security review: FinCom Bridge 2.5.1 (the stock from Tally only on a person's click; cloud migration 134)

Reviewer: independent review sessions run with Claude Code (the code-review tool's forked reviewers, high effort, with
the security questions below), and the build session's own pass over each finding. They did not write the change.

Range: RANGE_PLACEHOLDER

## What can make the bridge ask Tally for the stock

- Only a click: a signed-in member of the firm (Bearer token, two-step done) calls tally-ingest {kind:"wake",
  what:"stock"} for one of the firm's clients; tally_stock_ask (service role only) records it against the firm's own book
  and gives it a time; ONE computer of the firm is woken. The bridge takes the click from its own heartbeat answer (its
  computer key) or its Realtime channel (the topic is the computer's own unguessable wake token, as for "update" and
  "ledgers"). Each click is taken once by its time; nothing else in the bridge builds the request (TestStock251ClickOnly
  drives Update now, the ledger read and a heartbeat).
- The request itself: on the allow-list, pinned byte for byte to its builder (company and period the only inputs, the
  company XML-escaped, the period two real yyyymmdd days at most two years apart); the ReadDays / dated guard lets it through
  only while that exact request is a click's in flight and only under the 2 s hard stop (never a person's request, which has
  none). The computed-figure exception is exactly this id as built: one Group collection, the reserved Stock-in-Hand only,
  three fields, no $$ function, the period once (TestStock251FiguresAndExceptions: another id, type, group, field, a second
  collection or no period is caught).

## Findings

1. (Low, accepted, as before for "update" / "ledgers") Someone who learned a computer's wake token could broadcast "stock"
   clicks with made-up times. Each costs at most one read of Tally's Stock-in-Hand (2 s stop, one in flight, postings
   first); the answer is refused by FinCom's cloud (no such click: tally_stock_answer matches the recorded click time and
   takes one answer only), so nothing is stored. The token is never shown to people and is per computer.
2. (Fixed in round 1 of the code review) One click woke every computer that named the company (several Tallys asked; a
   late answer could overwrite): now one computer, one answer per click.
3. (Fixed in round 1) The ReadDays exemption did not require the 2 s stop: now only a copier read with its 2 s hard stop.
4. Data: the stock figures (opening and closing value of the period) are kept in tally_stock_reads with row security
   (a member reads the firm's rows only; no direct writes; anon nothing); the bridge's answer is taken only from a computer
   that named the company in its own heartbeat, for a company linked to the firm's book, with the book's company GUID; the
   numbers must be finite, the status one of six, the words cut to 300 characters; no computer name or Windows login in
   anything stored or shown. In the app the words and figures are shown as text (React), never as HTML.
5. SQL: both functions SECURITY DEFINER with search_path set, refuse anyone but the service role, the book checked against
   the firm; explicit GRANTs (service_role; authenticated select only; anon nothing); add-only, one transaction, lock_timeout
   10 s, runs twice (run_migration134.py checks every grant and the row security).

No High or Medium finding is open.

## Rounds

The code review's three rounds (docs/reviews/bridge-2.5.1-code-review.md) were asked the security questions too (who can
make the bridge ask Tally, the narrow exceptions, row security and grants): nothing open in rounds 2 and 3 ("the
exemptions match the guard on the older-entries batch read; row security, the grants and the service-role checks in
migration 134 are sound"). Recorded: an answer is not tied to the computer woken (it needs the click's time, which only
that computer's channel and beat carry; and the book's GUID, a computer that named the company, one answer per click).
