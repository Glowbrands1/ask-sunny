# Handoff: coding 6 → "Coding-6" (10 Nov 2026, ~19:30Z)

Docs only. Everything below is pushed; nothing lives only in the old sandbox. All flags are **default off**.
Every replay case named here fails with production's flags and passes with its flag on (checked locally).
The people in the cases are invented (Tamsin Oakridge, Marisol Pennick, Brisa Langtry).

Standing rules (from QA): never merge, never push to main, never touch Vercel env vars, never force-push.
Don't touch MADE_ABOUT_*, FORM_NAME_FROM_ROSTER / ROSTER_*, ONE_CARD_ONE_PAGE, POLICY_TOPIC_INTO_FIELD,
CHAT_STAGE_TIMINGS / CHAT_PARALLEL_* or server-ask.ts structure (coding 2 is the only writer of server-ask.ts).
Protected files (flags-off-parity PROTECTED list) need Pau's written approval via QA.

## First thing to do

Run the full suite on every branch in the table below whose "suite" column is not green.
- Run at most two at a time.
- Exclude nothing.
- Known flakes that pass alone:
  - Bubbles `turn-lifecycle` "a slow turn write still yields a rateable answer" (also reported through flags-off-parity);
  - Sunny `chat-trace.migration`.

Then run the eval with the flag on: `docs/handoff/coding-6/evalone.sh <worktree> <FLAG> <out>`.
- The script edits `evals/flags.json` temporarily and restores it when it finishes.
- Read its "diffs" field. It must be empty: the off and on columns identical, or only better.

Then open one PR per app per bug and cross-link each pair.
- Use the repo's PR template.
- Fill the "Sibling app" section.
- Write "Supersedes #NNN" for the October PR it replaces. Don't close old PRs.
- Report each PR link and its full head SHA to QA.

## Branches (both apps use the same branch name unless noted)

| Item | Flag | Sunny head | Bubbles head | Suite | Eval (flag on) | Supersedes |
|---|---|---|---|---|---|---|
| #776 account before request (guard) | ACCOUNT_BEFORE_REQUEST | claude/chat-edits-details-before-card 94e4a196 | (coding 5 ports) | Sunny green, except one chat-trace.migration load flake | done earlier | — (PR #776 open) |
| Letter greeting any case | LETTER_GREETING_ANY_CASE | claude/letter-greeting-any-case add17d7a, **PR #798** | 3cb4e25f, **PR B#718** | S 21139 pass / 0 fail; B green except the known flake | S 63/63, B 35/35, no diffs | — |
| Termination stated ticks (P15) | TERMINATION_STATED_TICKS (+ NEXT_PUBLIC twin) | claude/termination-stated-ticks c0f25752 (coding 2's gate: 21168 pass) | 8b544c55 (tree = coding 2's gated ef493c44: 18245 pass) | green (coding 2) | **TODO** | stacked on #787 / B#707; Pau approved required-closing.ts + ca-action-plan.ts ("ok termination closing") |
| #2a second-person card | SAME_REQUEST_TITLE_ACCOUNT | claude/same-request-title-account 64ed5931 | fc3b81de | **S TODO**; B green (known flake only) | B 35/35 no diffs; **S TODO** | #233, B#155, B#164 |
| #2b A's date/payroll carried to B | CROSS_PERSON_FRESH_FACTS | claude/cross-person-fresh-facts d2c7f64b | 6ed124da | **S TODO**; B 18220 pass / 0 fail | B 35/35 no diffs; **S TODO** | #236, B#166 |
| #15 "bc" read into the name | BECAUSE_NOT_A_NAME | claude/because-not-a-name 5578b1d5 | d43d47c7 | **S TODO**; B 18216 pass / 0 fail | B 35/35 no diffs; **S TODO** | (no PR existed) |
| #1 "write up <name>" lower/all caps | WRITE_UP_NAME_ANY_CASE | claude/name-any-case 335217c0 | 6ed49899 | **TODO** | **TODO** | B#202 (and Sunny #270) |
| #5 prior actions with no comma | PRIOR_ACTIONS_NO_COMMA | claude/prior-actions-no-comma 59addb8c | 25a3413c | **TODO** | **TODO** | #255, B#187 |
| #6 store road with state (Bubbles) | STORE_ALIAS | — (needs approval, see below) | **claude/store-road-with-state** ed7e986a | **TODO** | **TODO** | B#186 (Sunny #254 when built) |
| #11 future incident date | FUTURE_INCIDENT_DATE_ASK | claude/future-date-question a87e9f22 | 46238f39 | **TODO** | **TODO** | #285, B#207 (BH5 part) |
| #9a forms guide (#262/#194 rebuilt on main) | FORMS_GUIDE | claude/forms-guide-on-main 84b64533 | b4c9d105 | **TODO** | **TODO** | #262, B#194 |
| #9b "write ca" / "needs CA" (Bubbles only) | CA_SHORTHAND_REQUEST | — (parity entry in the Bubbles branch) | claude/ca-shorthand-card 99692ef8 | **TODO** | **TODO** | B#181 |

Note: `claude/store-alias` (Bubbles) is the OLD #186 branch, so the new one is `claude/store-road-with-state`.

Superseded or scratch copies, kept only so nothing is lost (do not open PRs from them):
- `claude/termination-stated-ticks-v1-wip`: the pre-rebuild Termination commits, which included server-ask lines.
- `claude/local-integration-wip`, `claude/local-integration-2-wip`, `claude/b1-triage-wip`, `claude/p12b-on-main-wip`, `claude/same-request-wt5-wip` (Sunny) and `claude/local-integration-wip` (Bubbles): local integration and triage scratch.

## Things to do on specific branches

- **#2b Sunny (d2c7f64b) conflicts with main.** Main now wraps grounded-turn.ts's two returns in `withAccountTurnSources(…, input.request.history)` (#776).
  - #2b wraps the same returns in `withFreshPersonFacts(…, input.request[, people])`.
  - Merge main in (normal merge, no force-push) and keep both wraps.
  - #11's branch already does this kind of nesting: `withFutureDateQuestion(withAccountTurnSources(withEditDateRules(…)))`.
  - Then rerun its suite.
- **#11 also wraps grounded-turn.ts.** Whichever of #2b and #11 merges second gets a small conflict there; keep every wrap.
- **Termination PR pair**: run the eval with the flag on in both apps, then open the pair stacked on #787 / B#707.
  - Note the NEXT_PUBLIC twin.
  - Note Pau's approval: it is recorded in APPROVED_PROTECTED_EDITS.

## Waiting on QA / Pau

1. **Sunny #6 (salon alias): approval for protected `src/lib/forms/salon-mention.ts`.** QA passed the request to Pau.
   - Bug: "test testy, location o st, today's date, on 9-20-26 test was 10 minutes late clocking in" names no salon, because "location" written BEFORE a road alias is not a cue.
   - Proposed lines, behind STORE_ALIAS_ENABLED (same name as Bubbles):
     1. `import { storeAliasEnabled } from "@/lib/config/chat-quality-flags";`
     2. `const PLACE_BEFORE = /\b(?:location|salon|store)\s+(?:is\s+)?$/;`
     3. first line of `cued()`: `if (storeAliasEnabled() && phrase.includes(" ") && PLACE_BEFORE.test(before)) return true;`
   - A bare "o st" as a whole reply is a separate change, outside protected files (intake-augment.ts `uniqueRosterSalon`).
   - Only build it after the approval reply ("ok salon alias").
2. **#10, QA decided option 1.** Stack `CARD_TURN_NEVER_SILENT_ENABLED` on Sunny #790 (base `claude/p6-create-plain-reply`) and on Bubbles B#709, and say so in each PR body.
   - The fix is three more kinds in `src/lib/ai/card-meta-turn.ts` `kindOf` (that file exists only on the P6 stack), plus `withoutCardMetaTurns` keeping all three out of the Observation / draft account.
   - Reproduced on Sunny main, CA card from "create a ca for brisa langtry, she did not follow cleaning procedures today" (invented person), then:
     - (a) "can you make the form the same way again" → the identical reply word for word. Fix: point to **Create draft**.
     - (b) "i need to edit this" → the identical reply word for word. Fix: "What would you like to change? …".
     - (c) "i verified everythign i jsut need to finalize it" → appended to the Observation ("…cleaning procedures today i verified everythign i jsut need to finalize it"). Fix: point to Create draft, and say Finalize is on the draft.
   - P6 already covers "Create a Corrective Action Form from this conversation." via CREATE_REPLY_PLAIN (#790 / B#709).
   - Reported wording: Sunny #240 / B#170 (the triage tables in docs/parity-log/oct-pr-triage.md).

## Findings reported to QA, not fixed (not in coding 6's batch)

- Bubbles keeps a typed name's case on the card ("marisol pennick"); Sunny title-cases it. This is the other half of B#202.
- Sunny dates "… i assignd by 9-15" cards 9/15, and "missing the 11/1 woven deadline" cards 11/1. Both are deadline dates used as the form date.
- Bubbles: "she doesn't need a ca" (with "a") opens a card, through the existing "need a" creation verb.
- In Bubbles, "ca for <name> …" and "perf ca <name> …" still give no card even with CA_SHORTHAND_REQUEST.
  - That flag covers a verb directly before "ca", not "ca" leading the message.
  - Sunny gets cards through INTENT_EXTRACTION, which is on only in Sunny.

## How the replay cases are written

- Files: `src/app/api/chat/replay-pack/nov10-<slug>-cases.ts`, picked up automatically.
- `status: { open: "…" }` with `fixFlags: [FLAG]`: a run with production flags is an expected failure, and the run with the flag must pass. `status: "fixed"` is a guard.
- Run one file's cases: `npx vitest run src/app/api/chat/replay-pack/replay-pack-e2e.test.ts -t "<case id prefix>"`.
- Sunny scope: `KEARNEY`, role `salon_director`, `salonIds: ["loc-0309"]`, "Tanning Consultant".
- Bubbles scope: `WEST_DODGE` or `TWO_STORES`, role `location_manager`, `locationIds: ["loc-264"]`, "Team Member Part Time".
- Bubbles source must not contain "Ask Sunny" / "Sun Tan City"; write "the sibling app".
- Every new Sunny flag also goes into the flags-off-parity NEW_FLAGS list, after "APP_INSTRUCTIONS_NOT_ACCOUNT_ENABLED". Bubbles has no such list.
