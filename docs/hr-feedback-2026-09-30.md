# HR feedback, 30 September 2026 — Corrective Action policy, Exit Form notice and Details

Branch `claude/determined-carson-hw69yk`. Not merged. No migration. No
Supabase or Vercel change was made from this session.

Both items were reproduced in Production before any change, against the
records HR left the feedback on (conversations `557d9f05…` and `686c2d07…`,
instances `01c02bf5…`, `29c17ffa…` and `0dd17fad…`). Production was `9cd8dea`
(#81); #81 changed nothing on either path.

## Root cause per item

| # | Item | Root cause |
|---|---|---|
| 1 | "I had to tell Sunny the applicable policy (Standards of Conduct) for the CA for missing the Woven deadline." | The policy follows the Type of Offense box, and the box was the drafting model's choice alone. For a missed deadline it ticked Under Performance plus an "Other" write-in. Under Performance deliberately cites no manual section, so the policy came back blank. Nothing read the incident and nothing asked. |
| 2a | Submitted & Fulfilled Notice not ticked | `exit-facts.ts` read "worked her/his/their/the notice" only. "worked a two week notice" and "gave and worked 2 week notice" matched nothing. |
| 2b | Date notice was given blank | "provided" was not a notice verb, and only a cue *before* the date was read. "On 9-15-26, she provided her resignation" puts the cue after it. |
| 2c | Date notice was fulfilled blank | **Deliberate, unchanged.** The reader never takes the fulfilled date from the last day worked (see *Needs a decision*). |
| 2d | "via Woven" not read as the method | No Woven entry in `METHODS`. |
| 2e | Details restates title/location and opens with "She" | No Exit drafting rule against either; the coaching name/grammar rules are coaching-only. The prompt's "Keep the manager's specifics" encouraged keeping the title/location sentence. |
| 3 | Reason for Resignation ran into the next line (Kayla Koehn, 2 Oct) | `reasonIn` collapsed newlines into spaces before looking for where the reason ends, so the line break never ended it. |

## What changed

- **CA policy** (`lib/forms/ca-policy.ts`, new).
  - **What it reads.** The manager's turns are read for four cases: assigned work not completed, a required deadline missed, required Woven items or training not completed, and a manager's direction not followed.
  - **The proposal** (`form-proposal.ts` → `correctiveActionReady`):
    - Suggests **Standards of Conduct**, says what it rests on, and invites a change.
    - When the same account also reads as attendance (late or absent) or as a sales/performance target, it asks **"Which policy applies?"** and picks neither.
    - A policy the manager names wins, and the later turn wins.
    - The answer to the question continues the open proposal (`intentForTurn`). A question about a policy still goes to retrieval.
  - **The draft** (`instances/[id]/draft/route.ts`):
    - Standards of Conduct is ticked only when the pinned official manual's Standards of Conduct section, as it reads now, lists the infraction: "Failing to follow the policies and procedures of The Company", or "Insubordination -the refusal to follow the directions of the manager". Both lines are in the Production manual (Woven copy, chunks 36–37).
    - When ticked, it replaces Under Performance and the Other write-in. Policy Violated and Direct policy are then derived and quoted by the existing code, verbatim with "Source: JBA Policy Manual — Standards of Conduct, p. 12".
    - **A policy the manager named is the box that is ticked**, whatever the model chose (`statedOffenseKeys`, `withStatedOffense`). For example, "actually use attendance" ticks Tardiness or Absenteeism, depending on what the account describes. The policy fields are then derived as usual and fail closed where the manual has no section (Under Performance, Violation of Company Policies). This was added during pre-merge QA: before it, a named non-conduct policy only stopped the suggestion and left the box to the model.
    - No manual, no section, or a section without the line leaves the model's box and a blank policy, as before. Nothing writes a policy.
    - An unresolved two-way account keeps the model's box and adds a notice to check it.
    - The CHECKBOXES prompt also gets one classification line.
    - The response carries `caPolicy` (applied, source, section, page, anchor line, what was replaced, or why not).
- **Exit facts** (`exit-facts.ts`):
  - "provided" is a notice verb.
  - A date followed by "<she/he/they/name> provided/gave/submitted/sent… her resignation/notice" is the notice date. The employer ("we", "management") never counts.
  - "worked a/an … notice" counts as fulfilled, and so does "worked 2 week notice" (the word *notice* is required; "only worked 2 weeks" is still a tenure).
- **Exit method** (`exit-details.ts`): "Woven message" for "via/through/over/by Woven", "Woven message", and "messaged/sent … on/in Woven". "the Woven deadline" names no method.
- **Exit reason** (`exit-details.ts`): line breaks are kept, so a reason ends at its line.
- **Exit Details** (`exit-draft.ts`):
  - Two Exit-only drafting rules: don't restate the job title or location (printed in the header) unless it is part of how they left; refer to the employee by first name rather than opening sentences with She/He/They.
  - `dropHeaderRestatement` is a narrow backstop. It drops a sentence that says only "<name> worked as a <the form's job title> at the <the form's location>". It also cuts an aside that says only that (", a Tanning Consultant at NE Kearney,"). Anything with a date, a different role or salon, or a transfer is kept.
  - What was cut is reported as `exitHeaderRestated`, not as the "answers nobody gave" notice.

## Needs a decision (HR / product)

- **Should "Date that notice was fulfilled" equal Last Day Worked when the
  employee worked their notice?** It is deliberately not inferred today:
  `exit-facts.ts` documents that a fulfilled date is never computed from a
  duration or another line. HR's feedback expects it filled. Unchanged until HR
  confirms; then it is one rule in `readExitFacts`.

## Found, not fixed

- **Eligible for Rehire read as No** on the 2 Oct Kayla Koehn form
  (`ab430f4b…`). The manager typed "Store items returned payroll deduction does
  not apply eligible for rehire" on one unpunctuated line. The "not" of "does
  not apply" is within the negation window (`NEGATED_BEFORE`, three words) of
  "eligible". The window is shared by every yes/no answer, so narrowing it is
  not a low-risk change; it needs its own fix and tests. The stored value on
  that form should be checked by the manager.
- A correction after the CA form exists ("the policy violated is the standards
  of conduct" once the draft is created) still goes to retrieval; `chat-correction.ts`
  does not handle the Corrective Action Form. Unchanged.
- The Details pronoun rule is a prompt rule; whether the model follows it can
  only be confirmed on a live draft.

## Tests

`lib/forms/ca-policy.test.ts`, `lib/forms/exit-draft.test.ts` (new); additions
to `exit-facts.test.ts`, `exit-details.test.ts`, `ai/exit-form-conversation.test.ts`,
`ai/corrective-action-conversation.test.ts`, `api/forms/exit-draft-route.test.ts`,
`api/forms/pm-draft-route.test.ts`. Mutation check: with the five source files
reverted and the tests kept, 49 of the new tests fail.
