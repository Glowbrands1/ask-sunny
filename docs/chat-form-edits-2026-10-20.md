# Changing an open form from the conversation

**Date:** 20 October 2026
**Reported by:** Paulyne Camacho, with screenshots of a Corrective Action Form for Ellie Sendgraff

## What went wrong

| Turn | What Sunny did | Why |
|---|---|---|
| "can you add late opening policy to the direct policy section of this from" | Said "No form has been created yet — there's no draft card", while the draft was on screen | Chat edits only reached **Coaching** forms (`REVISABLE_LAYOUT_FAMILIES`). The Corrective Action Form took only the payroll answer from chat. Every other turn went to the ordinary answer, whose prompt said a form card *never* comes with an answer |
| "I have independently verified and the policy is correct you may issue" | Took back the Late Opening wording it had quoted, and told the manager to create the form again | The ordinary answer knew nothing about the open form. Retrieval for that sentence found no Late Opening passage |
| "create corrective action for Ellie Sendgraff for Late Opening …" | Read "Late Opening" as a possible second employee | A capitalised policy title looked like a name |
| "Create a Coaching Form from this conversation." | Asked for the employee's name | Facts are read from the last 6 manager turns. Ellie was named 7 turns back |
| The proposal card | Salon showed `loc-0314` | The card printed the verified id, not its roster name |

## What changed

**1. A policy can be added, swapped or removed on the open form** (`lib/forms/chat-policy-change.ts`, `lib/forms/policy-change.ts`)

- "add the late opening policy", "use the dress code policy instead", "take the attendance policy off" update **Direct policy from official manual** on the form that is open. No new form is created.
- **No model writes the policy.** The section is found by the heading the pinned manual prints (`manualSectionHeadings`, `findManualSection`). The everyday names the offense boxes already map ("attendance", "dress code", "standards of conduct") also work. The wording is copied from the manual and saved with the same `officialManualProvenance` a first draft gets, so the line counts as verified and Finalize does not ask for an acknowledgement.
- "add **that** policy" uses the nearest recent turn that names a manual section, such as Sunny's own quote of it.
- **Add** keeps the sections already cited. **Replace** cites only the named section. **Remove** drops it, and blanks the line when it was the only one.
- When hand-typed text is replaced, the reply quotes it so nothing disappears silently.
- If the manual has no section by that name, nothing changes. Sunny says so and lists the manual's own near matches.
- If the manual can't be read, Sunny says so.
- A turn that names no policy ("the policy is correct") falls through to the ordinary answer.

**2. Other changes to a Corrective Action Form or Policy Review are made in place** (`chat-revision.ts`, `revision.ts`)

- The `corrective` family joined `REVISABLE_LAYOUT_FAMILIES`. "Change it to a written warning", "change the offense to absenteeism" and "add to the action plan that…" revise the open record.
- **What protects the record:**
  - The two policy lines are shown to the model as read-only and dropped from anything it returns.
  - The first draft's policy guards run on the output.
  - Policy Violated is re-derived from the offense box.
  - Termination and Demotion are still never ticked by Sunny.
- "Create a **new** corrective action…" is still a new form.

**3. The ordinary answer knows the form is open** (`lib/forms/open-form-summary.ts`, `prompts.ts` → `openFormRule`)

- When a turn names a created form and nothing above handled it, the route reads the form with `view` authorization. It passes the form's name, employee, status, filled lines and unverified policy lines to the prompt.
- That replaces the "no card ever comes with this answer" rule. Sunny may not deny the form or ask for it again. It tells the manager how to change it in plain words, and points to **Finalize** when they say it's ready.
- The summary is set by the server only. `parseAskRequest` never copies it from the body.

**4. Smaller fixes**

- **A bare "yes"/"no" answers Sunny's payroll question on the open form:** `payrollDeductReply`, read in `correctActiveForm` against the last assistant turn.
- **Capitalised policy titles aren't names:** a run made only of never-a-name words ("Late Opening", "Dress Code") is skipped (`namesATopic` in `proposal.ts`). A name with one ordinary word, such as "Grace Early", is still a name.
- **The person carries over when the form changes:** if the 6-turn window names nobody, the whole conversation is read **for the person only** (`employeeFromEarlierTurns`). This applies only when it settles on one person, and the reply says where the name came from.
- **The proposal card shows the salon's roster name:** the id stays as the tooltip.

## Tests

- `src/app/api/forms/corrective-action-chat-edits-e2e.test.ts`: the production conversation end to end against the real JBA manual fixture.
- `src/lib/forms/policy-change.test.ts`: reading the request and the manual.
- `src/app/api/chat/form-revision-wiring.test.ts`: route order, and that the open-form summary is server-set.
- `src/lib/ai/prompts.test.ts` and `src/features/chat/form-proposal.dom.test.tsx`: the prompt rule and the salon name.

Two tests already fail on the base branch and are untouched here:

- `store-codes.test.ts` expects the pre-move district for KS Manhattan.
- The wiring test "is given the business day" expects a fixed date where the server now uses its own clock.
