# Two people who are both "she" are never mixed up; the saved Observation keeps another employee's "they"; the reword reply (Ask Bubbles #1053, db7201b1) — ported

**Report (Ask Bubbles' QA, 22 Nov 2026, production, and its live round 3, U23):** the manager wrote about <A> (she) and
a coworker <B> (she) who was giving <A> an attitude; the write-up said "<A> was giving <A> an attitude" (a coworker who
is "he" broke the same way). U23: the card kept "she asked another employee what they would do if they had 8 arms",
but Create saved "what <P> would do if <P> had 8 arms". U23 T7: "take what i said but use it in a more professional
tone" got "Rewording isn't available yet."

**Ask Sunny: same gap, and more.** Sunny's `withoutPersonPronouns` (`agent-loop/reply-pronouns.ts`) had neither the
pronoun-kind check Bubbles added in #1041 (U23 round 2) nor #1053's same-kind check, and `first-name-write-up.ts`
called it with no other people and no manager words, so Create replaced a coworker's "she" and another employee's
"they" with the employee's name. The replay cases below fail on main.

**Port (the mechanism; Sunny's fixtures, every person invented):**
- `reply-pronouns.ts`: the pronoun-kind check from #1041 (the manager calls the person only "she", or only "he": a
  pronoun of another kind is someone else) and #1053's `sameKindOther` (each named person's kind read from the
  manager's own words; a she/he pronoun whose nearest named person of its kind is someone else stays; an object pronoun
  is never the person named in its own clause; unsettled, left as written). Only when another person of that kind is
  named: single-person write-ups read as before. No word lists.
  **Sunny differs:** inside a reported clause Sunny's reported-speech reading (Pau's ruling) still decides; the same-kind
  reading applies only outside one. Without that, Sunny's c090 and c247 cases ("<P> messaged <SD>, <B> via Woven stating
  she quit": <P>'s "she") failed, as <B> is the nearest named "she" before the pronoun.
- `first-name-write-up.ts` (`otherRosterPeopleIn`) and the draft route: Create's pass gets the roster people the notes
  name (never the employee, by legal or preferred name) and the notes, so the card and the saved form read pronouns with
  the same reader and the same words.
- Rules book: the reword_paused line and the "new facts with a reword ask" line say "I can't reword the whole account,
  but I can change any line you give me — tell me what to change." Rewording stays paused. Fixtures re-taken.

**Sunny-only test change:** the replay pack's every-reply pronoun judge (Bubbles' pack has none) now also leaves out a
sentence when an earlier sentence of the reply names another person the manager's message names, as the app's rule now
does. `nov15-agent-loop-batch-g-cases.ts` and `nov15-agent-loop-silent-failures-cases.ts` assert the new reword line.

**Tests:** unit `reply-pronouns-two-same-kind.test.ts` (6 fail before, all 10 pass after); replay
`nov22-agent-loop-two-she-write-up-cases.ts` (two "she", "he" coworker, legal Elspeth / preferred Billie, and U23's
saved "they" fail before in both flag modes, 8 runs; the one-"she" control passes before and after).

**Live harness:** not run here (the permission check refused the key); QA runs the live set.
