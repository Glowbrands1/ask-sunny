# Tester feedback on chat forms: root causes and fixes

**Date:** 29 September 2026
**Source:** Ask Sunny feedback queue, 1–3 star comments from 23 to 29 September 2026 (District Managers, plus Admin test rows).
**Status:** on branch `claude/sleepy-carson-7vm1s2` for QA. Not merged to `main`.

4- and 5-star rows with no comment were not treated as bugs.

## 1. What the testers reported

| # | Rating | Tester's words (short) | Form |
|---|---|---|---|
| A | ★ | "provided sunny the following information twice and sunny still did not create coaching form: employees name, lisa smith, location was lawrence and lisa's title is tanning consultant. told sunny to use today's date twice." | Coaching |
| B | ★ | "did not create coaching form after all pertinent info provided" | Coaching |
| C | ★ | "did not create CA form, told sunny twice the employee name, job title and location and sunny still asked for that info after it was provided" | Corrective Action |
| D | ★ | "did not create ca form even though i went back twice and added 'missing information'. every time i rate my experience, the screen scrolls way down…" | Corrective Action, rating UI |
| E | ★ | "sunny pushes for coaching vs ca for most all situations - not taking into account that employee's have acknowledged the jba policy manual and completed other relevant training (i.e. TC Training)" | Guidance |
| F | ★★★ | "provided address and not filled in on form. Sunny wrote: 'She did not call in…' … Sunny should say Christiana did not call in. I did not use Exit Form Sunny created" | Exit |

The live data agrees with A–D. On 23 September the tester's Corrective Action attempts all ended as forms created by hand on the Forms page (three CAs and one Coaching Form, `source = manual`), not from chat.

## 2. How a message becomes a form (the path traced)

```
browser (chat-screen.tsx) sends: history + continueProposalTemplateKey (continuationFor)
 → /api/chat → server-ask.answerQuestion
 → form-proposal.proposeFormForTurn → intentForTurn          (which form, or "not a form turn")
 → proposal.buildProposal over managerContext(...)           (employee, title, salon, date)
 → proposalContent                                           (the card text: what's filled, what's asked)
 → [Create draft] → createInlineForm → POST /api/forms/instances (create, stated facts)
 → POST /api/forms/instances/[id]/draft                      (model writes narrative, guards run)
 → form_instance_values → inline form / PDF
```

The form's details are **re-read every turn** from a bounded window of the manager's own turns (6 turns / 4,000 characters). The only thing carried from turn to turn is the open form's template key. That's the existing single source of truth, and it stays: a second, merged copy of the values in the browser was rejected in Phase 3 because it drifts from `form_instances`. The values weren't lost in that window. They were lost at the two points below.

## 3. Root causes

### 3.1 An answer with no name dropped the open form (A, B, C, D)

`intentForTurn` (`src/lib/ai/form-proposal.ts`) kept an open form only when the new turn **named an employee** in a position the name reader accepts. Every other answer to the intake counted as a new subject:

- "Lawrence, Tanning Consultant, use today's date"
- "she did not call in for her shift on saturday"
- "employees name lisa smith, location was lawrence…" (lower case, labelled)

Those turns went to the knowledge base, and the model asked for the details again. That answer carried no form, so `continuationFor` returned nothing, and **every later turn was a new subject too**, however many times the details were given. That's the "told sunny twice" loop.

**Fix.** A turn that states something the form is made of now continues the open form (`src/lib/forms/form-turn.ts`, `statesFormFacts`). That means a name, job title, salon, date or "today", address, labelled answer ("location was…"), incident description, prior warning or coaching, or policy/training history. It uses the same readers as the proposal. A question ("what's the policy on no call no shows?") is still a question.

### 3.2 The readers missed how testers actually typed (A, C)

| Tester typed | Before | After |
|---|---|---|
| `employees name lisa smith` | no employee | Lisa Smith (labelled name) |
| `lisa's title is tanning consultant` | no employee | Lisa (possessive before a title) |
| `Lawrence, Tanning Consultant, use today's date` | **"Lawrence" became the employee**, replacing Lisa Smith | Lawrence is the salon; Lisa Smith stays |
| `location was lawrence` | no salon | KS Lawrence |
| `…at Lawrence. Use today's date` | no salon (the full stop was erased before the cue was read) | KS Lawrence |
| `use today's date` | no date; the form fell back to the database's **UTC** day, a day ahead on a US evening | the business day |
| `her address is 1234 Elm St, Lawrence` | **"Elm St" became the employee** (found by the new e2e test) | not a person |

Files: `proposal.ts` (labelled and possessive names, a salon never read as a person, an address never read as a person, "today"), `salon-mention.ts` (label cue, whole-clause cue, clause breaks kept), `instances.ts` (the default date is `businessToday()`, not the column's UTC `current_date`).

### 3.3 A word inside the answer switched or dropped the form

With a Coaching Form open, "she already got a verbal warning last week" switched it to the Corrective Action Form ("verbal warning" is a legacy alias). "She received corrective action last year" dropped it for an explanation of the ladder. Now, with a form open, a different form wins only when the turn **asks** for it (`requestsAForm` in `template-intent.ts`): a creation verb, the form's name leading the message, or "instead" / "switch to". "Actually let's do a CA instead" still switches.

### 3.4 The Exit Form's address had no route to the form (F)

Permanent Address is a `manager` field, so the drafting model can't write it (correct: a model would invent one). But nothing else wrote it either, and the intake told managers it was "yours to complete". An address the manager labels ("address is…", "lives at…", "mailing address…") and that starts like a street address is now read (`src/lib/forms/stated-address.ts`). It's shown on the card and sent at creation. It's written through `applyStatedFacts` as the manager's statement, restricted to that one key and validated against the pinned version, the same path as the CA's payroll answer. The model's own address value is still dropped.

### 3.5 Narratives used gendered pronouns (F)

The drafting prompt gave the model a name and no rule, and its own Plan of Action template said `<he/she/they>`. Now:

- The prompt tells the model to refer to the employee by name and never as she/he/her/him/his/hers.
- `src/lib/forms/employee-reference.ts` runs on what comes back. A sentence-initial "She" / "He" / "She's" / "Her …" / "His …" becomes the employee's first name.
- The guard leaves three things alone:
  - text inside quotation marks
  - mid-sentence pronouns ("told her" vs "her shift" can't be told apart safely)
  - any pronoun right after a sentence that introduces another person ("A customer complained. She said…"). Putting the employee's name there would change a fact.

### 3.6 Coaching was offered for almost everything (E)

The Performance Management Framework in the knowledge base is explicit:

- **§1.3:** "Ask Sunny should also not under-document a repeated issue or policy violation by calling it 'just coaching' when the employee has already been coached or the issue is serious."
- **§2.7 (DPOA, now the Corrective Action Form):** use it "when an employee violates policy; when the issue is attendance, tardiness, leaving early, dress code, standards of conduct, or company policy; when the employee refuses or fails to follow management direction; … when the issue is serious enough to require immediate accountability."
- **§4.3:** a knowledge gap is retrained; an employee who "knows what to do but does not do it" is an effort gap and is documented.

The code read none of this. Nothing looked at policy acknowledgement, completed training or severity. The suggestion cards never offered the Corrective Action Form unless the manager had typed a warning's name, and even then offered it last.

**Fix, grounded in those sections, with no new policy invented:**

- **Suggestion cards** (`form-opportunity.ts`). A new `accountability` case covers two situations: a *policy or conduct* concern where the manager said the employee acknowledged the policy, completed the training, or was already coached or warned; or a serious issue (no call no show, walked out, theft, harassment…). In that case the Corrective Action Form is offered **first**, with Coaching beside it. §7 still holds: underperformance and metrics still start at coaching, whatever training was done.
- **Chat rules** (`prompts.ts`, `EMPLOYEE_PERFORMANCE_RULES`). "The lightest APPROPRIATE step, not the lightest step." Where the manager hasn't said enough, name the deciding factors and ask the one question that settles it, instead of defaulting to coaching.
- **Drafting rules** (`escalation-guard.ts`). An acknowledged policy is not a knowledge gap.

### 3.7 Rating the conversation scrolled the page away (D)

Each star and outcome pill hides a real radio with `sr-only`, which is `position: absolute`. No ancestor was positioned, so the radio was laid out against the page, not inside the scrolling conversation. Clicking a star focuses its radio, and the browser scrolls the focused element into view.

In Chromium, with a reproduction of the chat layout, one star click scrolled the page **4,199px** and left the stars 3,552px above the viewport. With `relative` on the labels, the page doesn't move. The fix is in `conversation-rating.tsx`, which every Ask Sunny surface shares.

## 4. Behaviour before and after

| Conversation (District Manager, global scope) | Before | After |
|---|---|---|
| "I need a coaching form" → "employees name lisa smith, location was lawrence and lisa's title is tanning consultant. use today's date" | Form dropped; the model asked for the details again | Coaching Form ready: Lisa Smith · Tanning Consultant · KS Lawrence · today |
| "Coaching form for Lisa Smith" → "Lawrence, Tanning Consultant, use today's date" | Employee became "Lawrence" | Lisa Smith · Tanning Consultant · KS Lawrence · today |
| "Create a coaching form for Lisa Smith. She is a Tanning Consultant at Lawrence. Use today's date." | No salon, no date | All four filled |
| "create a CA" → "employee name is maria lopez, job title is tanning consultant, location is lawrence" | Form dropped | Corrective Action Form for maria lopez at KS Lawrence |
| "CA for maria lopez" → "she did not call in for her shift…" | Form dropped | Form kept |
| Coaching open → "she already got a verbal warning last week" | Switched to Corrective Action | Stays Coaching |
| Coaching open → "actually let's do a CA instead" | Switched | Switches (asked for) |
| Coaching open → "what is the policy on no call no shows?" | Knowledge answer | Knowledge answer (unchanged) |
| Exit Form with "her address is 1234 Elm St, Lawrence, KS 66044" | Address blank on the form | Address on the card and the form |
| Drafted Details "She did not call in…" | Stored as written | "Christiana did not call in…" |
| "Jessica was late again. She acknowledged the JBA policy manual." | Coaching only | Corrective Action Form first, Coaching beside it |
| Picking a star | Page jumps | Page stays put |

## 5. Tests

New:

- `src/lib/ai/tester-form-feedback.test.ts`: the testers' conversations replayed through `answerQuestion` with the browser's own `continuationFor`, plus form-switch isolation, questions mid-form, and the prompt rules (13 tests).
- `src/app/api/forms/exit-address-e2e.test.ts`: conversation → create → draft → stored values. The model writes "She did not call in…" and its own address; the record holds the manager's address and the employee's name.
- `src/lib/forms/stated-address.test.ts`, `src/lib/forms/employee-reference.test.ts`: the two new readers.
- `form-opportunity.test.ts`: first-time issue, policy acknowledged, training completed, repeated after coaching, serious, and underperformance (§7).
- `proposal.test.ts`: an address is not a person.
- `conversation-rating.dom.test.tsx`: every hidden radio sits in a positioned label.

Changed on purpose (they pinned the old behaviour):

- `corrective-action-conversation.test.ts`: "today" now resolves to the business day instead of null (2 tests).
- `exit-draft-route.test.ts` and `exit-form-e2e.test.ts`: the drafted Details are stored with the name, not "She" / "Her".
- `coaching-autocomplete.test.ts`: the guard chain now names the employee before the date correction.

**Mutation checks.** Each fix was reverted on its own and its tests failed:

- continuation gate: 2 failed
- incidental-mention rule: 3
- labelled names: 2
- salon never the employee: 1
- salon label and clause cues: 4
- "today": 3
- address removed from names: 2
- address written at create: 1
- pronoun guard: 1
- Corrective Action first: 4
- rating label positioned: 1

**Gate:** `npm test` 9,260 passed and 53 skipped (390 files, 384 passed and 6 skipped); `npx tsc --noEmit` clean; `npm run lint` clean; `npm run build` succeeds.

**Not verified:** no Preview QA on laptop or mobile, no live model call, and no live database write. The model and the database are faked in these tests. The scroll fix was checked in headless Chromium against a reproduction of the layout, not against the deployed app.

## 6. Open questions for Operations / HR

1. **Which "serious" issues go straight to the Corrective Action Form?** The list used is the framework's own examples plus a few obvious ones: no call no show, walked out, theft, harassment, threats, violence, intoxication, falsification. §2.8 sends several of these (theft, harassment) to **Further Leadership Review**, which has no form. The drafting rules still refuse to select termination, demotion or suspension and still send those decisions to leadership. Confirm the card order is right for these.
2. **Should the Corrective Action Form lead whenever the manager names a formal step** ("I think this needs a written warning")? It is still offered last in that case, as before. Only an acknowledged policy, completed training, prior coaching or warning, or a serious issue moves it first.
3. **Pronouns mid-sentence.** Only sentence openings are rewritten automatically. The prompt asks for the name everywhere, but a mid-sentence "her" the model writes will stay. Is that acceptable, or should the business review a stricter rule?
4. **The Exit Form's "I did not use Exit Form Sunny created".** The address and the pronoun were fixed. If there was another reason the tester discarded it, it isn't in the comment.
