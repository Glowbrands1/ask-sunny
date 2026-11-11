# Step B: which replies FORM_REPLY_FROM_DIFF_ENABLED can rewrite

Ported from Ask Bubbles (`docs/step-b-reply-rewrites.md` there, claim rule
of 3 Nov 2026); the same code and rule here, with this app's paths and keys.

`FORM_REPLY_FROM_DIFF_ENABLED` (with `FORM_PATCH_REDUCER_ENABLED`; both default off).
QA ruled on 3 Nov 2026 that a path's guidance is never dropped when what it
claims is true. This page lists what can still be rewritten under that rule.

## The rule (`checkedClaim`, `src/lib/forms/form-snapshot.ts`)

When both flags are on and a form is open, the chat route reads the open form
before the answer cascade (`snapshotForm`: the header columns and every value
row). After the cascade it checks the answer if all of these hold:

- the answer came from **correction**, **policyChange**, **redraft**,
  **sameCopy** or **revision**;
- it carries a `formUpdate`;
- the `formUpdate` names the open form.

For such an answer, the form is read again and the claim is checked. Nothing
is read from the reply's words.

Rule as ruled by QA on H1–H5 (3 Nov 2026). A key "changed" when its value
changed, or when its stamp (`filledBy` and `provenance.source`) changed. So a
policy line re-verified against the manual with the same words counts (H2).

| What happened | Reply | `formUpdate` |
|---|---|---|
| **At least one** claimed key changed in the saved form | **the path's reply, byte for byte**, with all its guidance and questions | as the path wrote it |
| **None** of the claimed keys changed, and nothing changed at all | `I didn't change anything on the form.` | removed |
| **None** of the claimed keys changed, and other keys did | one `Changed <Label> to "<value>".` / `Cleared <Label>.` line per key that really changed | the keys that really changed |
| No claim, or an empty one (`updated: []`), whether or not the form changed | untouched, nothing appended (H5) | as it was |
| A claim naming a key the form does not have (neither snapshot holds it) | untouched (H3, a known limit: such a claim can never be checked) | as it was |

**What this rule can no longer catch:**

- A reply that claims several fields, of which only some changed, keeps its
  text, including its sentences about the fields that did not change. For
  example, a redraft that re-writes the same policy line while changing
  Observation keeps "Updated … policy …" wording.
- The rule catches a false "Updated" only when nothing claimed changed:
  - re-writing a value the field already had, such as "change the date to"
    the same date, or re-ticking the same options (H1, H4), is caught;
  - a mix of true and false claims is not.

**Not checked:**

- a patch turn (`form-patch-turn.ts`): its reply is built from its own
  realized diff, and it has no guidance;
- a draft action;
- the name-correction refusal;
- `reopened`, and the ordinary answer (`answerQuestion`, including its card
  intake). These keep `honestFormReply` as today. (This app has no `which`
  step.)
- a `formUpdate` naming another form, such as the new draft a finalized form
  is revised into.

## When a path's reply can be replaced

A path's reply is replaced only when NONE of the keys its `formUpdate` names
changed (in value or in who wrote it and from what). When that happens, none of that path's guidance is
shown on that turn.

| Path | When its claim can be false | What the manager sees instead |
|---|---|---|
| correction (`chat-correction.ts`) | A claimed key already held that value, e.g. "change the date to 10/20" when it is 10/20, or the payroll answer restated. A field the save refused is already left out of the claim. | `I didn't change anything on the form.`, or the lines for what else changed (for example a moved paragraph or a rebuilt Action Plan) |
| policyChange (`chat-policy-change.ts`, `policy-rest-of-turn.ts`) | The cited section is re-quoted with the same text, so only the provenance changes (the line is now "checked against the manual"), or Policy Violated or the Action Plan were rewritten unchanged | the same |
| redraft (`chat-redraft.ts`) | It claims every key the draft route's response lists. That list can include keys rewritten with their old value, such as the derived policy lines or a plan built the same, and those keys pass through the reducer unchanged. | a line per field the redraft really changed. **The redraft's policy-confirmation guidance is lost on that turn.** |
| sameCopy (`same-form-copy.ts`) | A copied field already held the copied text | a line per field that changed. **The pronoun warning is lost on that turn.** |
| revision (`chat-revision.ts`, `form-content-turn.ts`, `open-draft-turn.ts`) | It claims `follow_up_date` and the date did not move, or a plan key when the plan sync wrote the same text (here the Action Plan is manager-only in production, so the sync writes nothing) | the same |

The test pins: `src/lib/forms/form-snapshot.test.ts` (each rule on its own)
and the replay case `nov3-stepb-true-claim-keeps-guidance`. In that case,
"payroll deduct applies" on an open Corrective Action keeps the correction's
reply with `PAYROLL_AMOUNT_QUESTION` (`payroll-amount-field.ts`), word for word.

## Known holes (reported to QA; ruled on 3 Nov 2026: H1, H2, H4 and H5 are fixed by the rule above, H3 stays a documented limit)

1. **Same-value writes count as false claims.** A path that "updates" a key to
   the value it already had is judged false for the whole reply, even when its
   other claimed keys did change. The reply then loses its guidance.
2. **Provenance-only changes are invisible.** The snapshot holds values, not
   provenance. A policy line re-verified against the manual with the same
   words reads as "nothing changed".
3. **Key names.** Every path claims form row keys, plus `follow_up_date`. The
   snapshot carries the header columns under `employee_name`, `job_title`,
   `location`, `form_date` and `follow_up_date`, with a row of the same key
   replacing the column. A claim under any other name could never be confirmed.
   None was found in the five paths.
4. **Checkbox claims compare the ticked set.** Re-ticking the same options is
   a false claim (see 1).

---

## Draft mode and the payroll Yes/No (QA, 3 Nov 2026)

In draft mode, the payroll Yes/No checkbox (`payroll_deduct`) is checked only
against the group's options (`yes`, `no`, one of them). It is **not** checked
against the manager's words.

The reducer's verbatim check for manager-stated keys skips checkbox groups
(`!group` in `form-reducer.ts`). `reduceDraftWrite` also does not pass the
payroll keys as `managerStated`. `payroll_deduct` is a manager-responsibility
group, so it is not one of the reducer's writable keys in a draft. Whatever
the draft route decided for it passes through unchanged:

- the card's answer, written by `applyStatedFacts`;
- `statedPayrollDeduct`;
- `enforceResponsibilities` at the write.

What does hold in draft mode:

- the amount (`payroll_deduct_amount`, `PAYROLL_AMOUNT_KEY`, a text key) is
  written only from the manager's own words, by the route's existing
  `payrollAmountFromConversation` and `applyStatedFacts`;
- a date key is written only if `datesInText` finds that date in the manager's
  words (`sources.manager`, the notes).

## The "Other" box (QA, 3 Nov 2026)

`reduceDraftWrite` can leave out a drafted write-in line that only restates the
form's header (`restatesHeader`: the employee's position with the salon or
name, e.g. "Tanning Consultant at Kearney"). When it does, it also unticks the box that
line belongs to.

The link between a line and its box comes from the template's layout
(`writeInsOf`): a field placed directly after a checkbox group, whose label is
the label of one of that group's options. On the Coaching Form, Other topic
belongs to Topic of Coaching's "Other" box. This needs no key or word list.

**Limit:** a write-in with no box labelled like it is left out alone. The
Corrective Action Form's "Other" line under Type of Offense is one: that group
has no "Other" option, so there is nothing to untick.

## The Action Plan here (ACTION_PLAN_MANAGER_ONLY_ENABLED)

`ACTION_PLAN_MANAGER_ONLY_ENABLED` is on in this app's production. The Action
Plan is the manager's alone: `syncCorrectiveActionPlan` returns at once, so
neither the draft write's `settle()` nor a patch turn's payroll change writes
a payroll sentence into it. A stated amount goes only to the Payroll
deduction amount field. See `docs/parity-log/2026-11-03-step-b-form-patch.md`.
