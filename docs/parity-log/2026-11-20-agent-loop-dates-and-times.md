# Agent loop: a prior action's date is never the form date; a minutes range is not a date; the card's times are saved (20 Nov 2026)

**Sibling app: not needed.** Ask Bubbles has no agent loop yet; the times guard only runs for a loop card (`cardFromLoop`).

- QA's production audit: "I need a verbal CA wrote up for <A>. I need the JBA policy for dress code enclosed. can you also
  site the coaching that was done on 11/3" put 11/3, the prior coaching's date, on the card as the form date. A date the
  prior actions hold (read from the manager's words, or as the model listed them) is never the form date, the model's
  (`date_is_prior_action`) or the fallback reader's, unless the manager also gives it as an incident date.
- QA's code audit on d7960a5f: "10-15 minutes late" was read as the date 10/15 (`dates.ts`); a number range followed by a
  length of time is never a date.
- Runner 2's c198: the loop card held 9:15PM, 9:01 and 8:11 PM; the draft writer saved only 8:11 PM. Create sends the loop
  card's account, and a clock time the drafted account lost brings back the card's sentence that holds it
  (`lib/forms/card-times.ts`), before the app's citation line; a field the manager typed is never touched.

Port with the rest of the loop when Ask Bubbles gets it.
