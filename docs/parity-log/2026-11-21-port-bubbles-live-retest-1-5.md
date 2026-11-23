# Five agent-loop fixes ported from Ask Bubbles' live re-test (21 Nov 2026)

**Sibling app: ported from Ask Bubbles** (branch `claude/live-retest-nov21-fixes`, pending as its #996). The mechanism
only: the cases use this pack's invented people (Remy Calder; Tavish Orcutt for QA2's R3 cases), salons and wording.

| Bubbles | What it fixes | Here |
| --- | --- | --- |
| 21066620 | A name corrected mid-chat replaces every spelling of that person in the card's account and the saved write-up (`short-name.ts` withCorrectedSpelling, `employee-match.ts` rosterSpellingOf) | Ported. This app's roster match has no "unchecked + closeName" result, so rosterSpellingOf reads only a single "confirm" candidate. This app's Create also drafts from the manager's own lines, so the draft route's loop-card short-name pass applies the same corrected-spelling pass first. |
| b52df4f8 | A card made at the step limit says what changed and "The card is for <name> at <salon>.", never "send the change again" (`run.ts` stepLimitReply) | Ported (`salon` for the sibling's `store`). `nov15-batch-f2-step-limit-names-the-card` changes its expectation on purpose. |
| 116961ae | Once set, the card's form date stays until the manager changes it (`tools.ts`) | Ported, as a pure `kept-form-date.ts` so it has a unit test. It also fixes QA2's Sunny R3 ("Which date goes on the form?", Create unanswered, saved today): no other fix needed. |
| 5589e202 | A dashed date ("10-1-26") is the same date as "10/1/26" in the keep-the-facts pass (`account-facts-kept.ts` sameDates) | Ported. |
| 1075d08d | A CA account with no subject is refused (`account_no_subject`, named in the rules book); issue-line dates slashed (`agent-loop/card-account.ts`) | Ported; prompt fixtures re-taken for the one rules-book line. |

**Sunny-only, to port back to Ask Bubbles:** QA2's Sunny R3 also saved "<First> was late to work on November 17, 2026.
<First> was late to work on November 18, 2026. <First> was late on the last two shifts, 11/17 and 11/18." The dashed-date
fix does not cover it (the dates are slashed). `account-facts-kept.ts` now holds a sentence that lists two or more
dates, each stated in a written sentence sharing one of its other words, when at most two of its other words are
nowhere in the write-up. Ask Bubbles has the same pass and most likely the same gap: port the mechanism with its test.
