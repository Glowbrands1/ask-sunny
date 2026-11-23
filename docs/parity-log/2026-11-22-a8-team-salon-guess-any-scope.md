# A team card's guessed salon is checked for every scope and on turns with no tool call (Ask Bubbles #1033, 59a30aa1, its QA's live re-run 2, A8) — ported

**Report (Ask Bubbles' production, a global login):** T1 "can you create a coaching form for my whole staff?"; T2 named a
program by its abbreviation and got "You have two <city> locations — <A> and <B>. Which one is this coaching for?"; T3
"this is perfect" called no tool and repeated the narrowed question.

**Ask Sunny: same gap.** Sunny's port of #1010 (`run.ts`, `teamNoSalon`) ran only on a team card waiting for its salon
(`needs_location`), and on a later turn only on the card record's `teamNeedsLocation`. A global login's team card with
no salon is `ready`, so it was never checked, and its `coach_team` result carried no `salon_question`.
`withoutSalonGuess` kept the question right after a dropped sentence. The replay cases below fail on main.

**Port (the mechanism; Sunny's salons, no sibling wording):**
- the check runs on any team card that holds no salon, whatever its status;
- the card record says so (`teamNoSalon`; an older record's `teamNeedsLocation` still counts);
- on a turn with no new card, the team card still shown is the last reply's card, else this chat's latest card record
  until a form opens (Sunny has no team-card update tool, so T2's `coach_team` is refused and T2's reply shows no new
  card; Bubbles reads only the last reply's card because its T2 updates the card);
- any team card with no salon carries `salon_question` and `salon_note`, with all the manager's salons (QA's ruling);
- `withoutSalonGuess` drops a question right after a dropped sentence in the same paragraph.

**Tests:** `salon-guess.test.ts` (2 new tests); replay `nov22-agent-loop-team-salon-guess-global-cases.ts` (a global
director and an admin; the manager's own T1 and T3, T2 in the Sunny wording of the #1010 port, the live replies with
Sunny's Lincoln salons): 5 fail before, pass after.

**Live harness:** Sunny has the harness (`AGENT_LOOP_LIVE`, `loop-stand-in.ts`), but this session's permission check
refused the run that would use the available key, so it was not run here.
