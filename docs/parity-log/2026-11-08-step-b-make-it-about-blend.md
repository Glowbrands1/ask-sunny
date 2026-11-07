# Sunny only: "make it about <X>" writes the account as X alone (STEP_B_MAKE_IT_ABOUT_ACCOUNT_ENABLED, the blend part)

QA's live AI checks (Sonnet 5 reader, production's flags, 8 Nov 2026) of STEP_B_MAKE_IT_ABOUT_ACCOUNT_ENABLED, on a saved Coaching draft about a missed monthly meeting, then "I need you to make it about showing up late":
- In the sibling app (Ask Bubbles #572, at bef0275), it passed 6/6 with the flag on (0/2 off). Its reader set Details of Coaching about showing up late.
- Here, 5 of 6 runs with the flag on wrote "Observed: <A> showed up late to the monthly meeting on 10/10/26", X merged into the old event, a fact nobody said. With the flag off, the old revision blends the same way.

So this app also has the blend fix, under the same flag (`forms/make-it-about-account.ts`, `forms/form-patch-turn.ts`, the added prompt line in `forms/form-patch-prompt.ts`). On a "make it about <X>" turn, Step B writes the account itself:
- It keeps the form's outline.
- Observed is the reader's text when that text is about X and holds none of the old event's words. Otherwise it is X in the manager's own words ("Observed: Showing up late."; QA's ruling, 8 Nov 2026).
- Any other part that still speaks of the old event is left empty.
- The reader's topic write is kept.
- QA's next live check (1174700) still blended in 3 of 4 runs. The reader did not answer, and the old path's revision wrote it. So the same rule now also runs in the one writer (`forms/form-write.ts`), for every path's write of the account after "make it about <X>". On the draft paths (the revision), it keeps the name and dates the account held: "Observed: <Name> — showing up late (10/10/26)."

Not ported to the sibling app. QA's decision (A), 8 Nov 2026: its behaviour is validated 6/6 as it is, and it shows no blend. The port was written and tested there (local branch `claude/step-b-blend-rebuild-unused`, e8b2b8b), not pushed. Port it if the sibling app's live runs ever show the blend.
