# FinCom go-live: the one-page summary

For: the owner. Written 26-Oct-2026. The full technical checklist is `docs/GO-LIVE.md`.

## What happens

Today your staff use the old FinCom (Build 199) at app.fincom.live. Everything built since then has been tried on the
testing site (staging) first. Going live moves all of it onto your real FinCom:

- the database changes (about 100 small update files);
- the server programs (about 14);
- the new app;
- the new Tally bridge (2.4.7).

Your clients' data stays. Nothing is copied from the testing site to the real one.

## In what order

1. **Two practice runs first, on a copy.** You make a copy of the real database from its backup. We do the whole go-live
   on that copy and time every step. We do this twice, on two fresh copies, and both must go cleanly. Then you delete the
   copies.
2. **You say "go" in writing.**
3. **The go-live day** (a Sunday, about 8 to 10 hours; the practice runs give the real time):
   1. Staff stop using FinCom.
   2. **You take a full backup**, of the database and of the uploaded files, and keep it on your laptop and Drive.
   3. You switch off the safety lock that stops Claude touching the real database. It is off for this day only.
   4. The database updates are applied, one by one, each checked.
   5. You enter the passwords and keys. Then the server programs go up.
   6. The new app replaces the old one at app.fincom.live. The old one is kept aside.
   7. The first computer gets bridge 2.4.7.
   8. We test together:
      - sign in, open a client and upload a bill;
      - post one entry into a **test** Tally company;
      - Ask FinCom answers;
      - a short test meeting.
   9. **You switch the safety lock back on.** Staff start work.
4. **Over the next days:** bridge 2.4.7 goes onto the other computers, about 15 minutes each.

## What only you can do

- Take the backups. Switch on "point in time recovery" a day before, a paid Supabase add-on that lets us rewind to any
  minute. Make the two practice copies.
- Switch the safety lock off on the day, and back on the same day.
- Enter the secret values: Supabase passwords and keys, the email service (Resend) for fincom.live, the sign-in web
  address, and the meeting keys from Cloudflare.
- Run two of the database files yourself in Supabase's SQL editor; Claude gives you the exact text.
- Install bridge 2.4.7 on each computer and connect it with its code.
- **Tell us what you "set up in Cloudflare".** It could be the website address (DNS), the website itself (Cloudflare
  Pages), or the meeting keys. The checklist works either way, but this step waits for your answer.
- Decide: Zoho on the real site now or later, automatic GSTR-2B matching now or later, and confirm no error-reporting tool
  (Sentry) on the real site.

## What can go wrong, and how we undo it

| If… | We… |
|---|---|
| a database step fails or a number does not match | stop, and rewind the database to the minute before we started (or restore your backup). The old app is still there, and nothing is lost |
| the new app misbehaves | put the old app back in about a minute (one saved copy is swapped back) |
| a server program misbehaves | put back the previous version, which you wrote down that morning |
| the website address does not answer | put the address setting back as it was. We lower its waiting time a day before, so this takes minutes |
| a computer's new bridge will not connect | it keeps the old bridge until it is connected. Your Tally data is untouched |

**The one point of no return:** once staff save new work in the new FinCom, rewinding would lose that work. So we test
everything before staff start, and the practice runs are there so the real day has no surprises.

## Still open before the practice runs

- Two timer files for Zoho and the 2B match need a "real site" version, or we leave them off at first.
- One speed-up file (76) has to be brought onto the release branch.
- The app must offer bridge 2.4.7 for download on the real site. This is a small reviewed change.
- An old compatibility test is re-run against today's server program.
- Your answer about Cloudflare.
