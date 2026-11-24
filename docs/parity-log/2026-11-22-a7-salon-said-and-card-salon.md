# The card's salon as the manager said it; the card record keeps its salon id (Ask Bubbles #1048, 739e4779, its QA's live round 3, A7 and A1(a)) — ported

**Report (Ask Bubbles' production):**
- A7: the card was filed at the store the manager named by another name, but the reply said "where Woven lists <P>'s
  store (<the manager's words> isn't one I recognize …)": nothing told the model the manager's words were that store.
- A1(a): T4 "she is at <city> <street>" made no card, and the reply's true "filed at <store>" was checked against the
  card record, which held no store for a person's card; the reply was replaced.

**Ask Sunny: same gaps.** Sunny's propose_form had no `salon_said`; its card record kept no salon at all (Bubbles kept a
team card's store; Sunny kept none), so the no-card check read every "Filed at <salon>" as a mismatch; and nothing caught
the rules book's own "where Woven lists" line when no card this turn was filed that way. The replay cases below fail on
main.

**Port (the mechanism; salon for store; people invented):**
- `tools.ts`: propose_form's result names the manager's own words for the card's salon (`salon_said`). Sunny's salon
  reader gives no matched text, so the words are the shortest run of the request's own words the reader reads as the
  card's salon, and only that salon. `salon_said` wins over `salon_from_woven`; the turn records when `salon_from_woven`
  was given.
- `rules-book.ts`: the `salon_said` line (fixtures re-taken, noted in `app-config.test.ts`).
- `run.ts`: a reply with the "where <staff system> lists" line when no card this turn was filed at the roster salon goes
  back once; if it comes back, that sentence is left out. The no-card check reads the card's salon from its record.
- `card-record.ts`: the card record keeps the card's salon id (`salonId`, an id, never a name), for a person's card and a
  team card alike.

No word lists.

**Tests:** replay `nov22-agent-loop-salon-said-and-card-salon-cases.ts` (5 cases, the testers' turns with Sunny salons;
invented people): all fail on main (10 runs, both flag modes), pass after. The team-card control also fails on main in
Sunny, because Sunny's record held no team salon either.

**Live harness:** not run here (this session's permission check refused the key); QA runs the live set.
