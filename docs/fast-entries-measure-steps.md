# Measuring the fast read on your Tally

Before the faster way of bringing older entries ("the fast read") can be switched on for a computer, FinCom needs to
know how quickly that computer's TallyPrime answers its two new questions on a real client's books. This sheet is how
you measure it. It takes a few minutes.

The measurement only reads. It never changes anything in Tally. It asks one question at a time, only while nobody is
working in Tally, and stops at once if Tally takes longer than 2 seconds or its window stops answering for 1 second.
Only times, counts and the names of fields go to FinCom, never the client's entries.

## 1. Choose when

Best outside office hours, or when nobody is entering vouchers in that company. The measurement waits whenever someone
types in Tally, and gives up after 2 minutes of it.

## 2. Choose the company

Any client company that is linked to a FinCom client (on FinCom's Tally page) can be measured, ZZ TEST too. A big one
(many entries on its busiest day) tells the most. The bridge must have seen it before: if it was never opened with the
bridge running, open it and wait a few minutes first.

## 3. Measure

1. In Tally, close every other company. **Open only the company to measure.**
2. Make sure no posting from FinCom is waiting.
3. Leave the fast read switched off. It is off unless FinCom support switched it on.
4. Right-click the FinCom Bridge icon (near the clock) and choose **Measure the fast read on the company open in
   Tally**.
5. The box names the company: "Measure on <name>? Tally is only read, nothing is written. It stops at once if Tally
   slows." Check the name and say Yes.
6. Leave the computer alone for a few minutes. Do not type in Tally meanwhile.
7. A box says **PASS** or **NOT A PASS**, the slowest answer in seconds, the longest moment Tally's window did not
   answer, and how many entries were the same.

If the box says it cannot start, it says why: no company or more than one open ("Open only the company to measure"),
the company not linked to a FinCom client, the bridge not knowing the company yet, the fast read switched on, or
Tally's window not on this desktop. Fix that and try again. Opening another company while it runs stops the
measurement.

## 4. What PASS and NOT A PASS mean

- **PASS**: every answer came in under 1.5 seconds, Tally's window never stopped answering for 1 second, and every
  entry the fast read brought was the same as when FinCom asks for it on its own. The fast read is safe on this
  computer for books like this one.
- **NOT A PASS**: one of those was not so. The box says which (a slow answer, Tally's window held, entries not the
  same, or the run stopped). The fast read stays off; FinCom keeps reading older entries the usual way. Nothing is
  wrong with your books.

The result also shows under Advanced (for support) on FinCom's Tally page, as "Fast read measured", with the
company's name. If the box says FinCom did not take the result, open **Show log** in the tray and send FinCom support
the last lines.

## 5. After a PASS

FinCom support switches the fast read on for that computer. Then, on FinCom, open that client and press **Bring books**
to see the real speed on its older entries.
