# Measuring the fast read on your Tally (ZZ TEST only)

Before the faster way of bringing older entries ("the fast read") can be switched on for a computer, FinCom needs to
know how quickly that computer's TallyPrime answers its two new questions. This sheet is how you measure it. It takes
about 15 minutes, plus the time to fill ZZ TEST.

The measurement only reads. It never changes anything in Tally. It asks one question at a time, only while nobody is
working in Tally, and stops at once if Tally takes longer than 2 seconds or its window stops answering for 1 second.
Only times, counts and the names of fields go to FinCom, never your entries.

## 1. Make the ZZ TEST company

1. In TallyPrime on the office server, create a company named exactly **ZZ TEST** (capital letters, one space).
2. In FinCom, on the Tally page, link ZZ TEST to a test client, as you link any company.
3. Leave ZZ TEST open for a few minutes, so FinCom Bridge records its starting point.

## 2. Fill ZZ TEST

ZZ TEST must hold at least as many entries as your biggest client, so the times are true for your real books. Look at
your biggest client in FinCom (Books › From Tally shows its entries) and note:

- its busiest day (the most entries on one day), and
- its busiest month (the most entries in 31 days).

Then fill ZZ TEST until it has at least that many on one day. Either:

- **The bridge's trial tool.** In FinCom, switch on "Trial tools on this computer" for the office server. In the
  FinCom Bridge tray, "Recorder trial: time saving" adds 100 test entries to the company open in Tally, dated today,
  each marked TRIAL. Run it as many times as needed. For example, 8 times gives 800 entries on one day. Switch the trial
  tools off again afterwards.
- **Or a copy of a big company.** Restore a backup of your biggest client's company in Tally under the name ZZ TEST.
  The entries stay in your Tally. The measurement sends FinCom only times, counts and field names.

## 3. Measure

1. Close every other company in Tally. **ZZ TEST must be the only company open.**
2. Make sure nobody is entering vouchers, and no posting from FinCom is waiting.
3. Leave the fast read switched off. It is off unless FinCom support switched it on.
4. Right-click the FinCom Bridge icon (near the clock) and choose **Measure the fast read (ZZ TEST only)**. Say Yes.
5. Leave the computer alone for a few minutes. Do not type in Tally meanwhile; the measurement waits whenever you do.
6. A box says **PASS** or **NOT A PASS**, the slowest answer in seconds, the longest moment Tally's window did not
   answer, and how many entries were the same.

If the box says it cannot start, it says why (another company open, ZZ TEST not linked or not recorded yet, the fast
read switched on). Fix that and try again.

## 4. What to send FinCom support

- A screenshot (or the words) of the result box.
- Your TallyPrime version (Help › About in Tally) and the office server's name.
- How many entries ZZ TEST had on its busiest day.

FinCom also receives the result by itself. It shows under Advanced (for support) on the Tally page, as "Fast read
measured on ZZ TEST". If the box says FinCom did not take the result, open **Show log** in the tray and send the last
lines too.

Afterwards you can delete ZZ TEST's test entries, or the whole ZZ TEST company. Nothing else changed.
