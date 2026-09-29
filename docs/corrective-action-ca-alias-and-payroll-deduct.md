# Corrective Action Form — "CA" aliases and "Is payroll deduct applicable?"

**Date:** 29 September 2026
**Requested by:** Madeline Patterson (Regional Director of Operations), via Paulyne Camacho

## 1. "CA" opens the Corrective Action Form

`detectTemplateIntent` (`src/lib/forms/template-intent.ts`) now rewrites the shorthand to the canonical words before any matcher runs (`canonicalCorrectiveAction`), so every existing rule, including the §7 metric-only check, applies to "CA" the same way it applies to "corrective action". There is still one template (`dpoa`). No second form was created.

| Typed | Result |
|---|---|
| `CA`, `ca`, `Ca`, `cA`, `C.A.`, `CA please`, `new CA` | Corrective Action Form |
| `CA form`, `ca form`, `corrective action form`, `Corrective Action Form`, `corrective-action`, `corrective-action form` | Corrective Action Form |
| `corrective action` / `Corrective Action` / `corrective actions` **on their own** | Corrective Action Form (**changed**: this used to be a knowledge question) |
| Misspellings: a word starting with `cor` within two edits of "corrective" (a swapped letter pair counts as one edit), followed by "action(s)" within one edit (`Corective Action`, `corrective acton`, `corrective actoin form`) | Corrective Action Form |
| `I need a CA for Dana Moss`, `create corrective action`, `pull up a corrective action for Dana`, `CA, she was late today`, `CA for Dana Moss` | Proposes the Corrective Action Form (creation request) |
| `what is corrective action?`, `what is a CA?`, `how does corrective action work`, `corrective action for repeated lateness` | Unchanged: knowledge question about the progression |
| `Their Club Close is low. Create a CA.` | Unchanged: §7, answered with the progression |
| `collective action`, `can you call me`, `cash was short` | Not a form request |

"CA" was added to the form vocabulary, so it's never read as part of an employee's name. Creation verbs gained `pull up`, `bring up`, `get me`, `fill in`, `begin`, `set up`, `put together`, `i need`, `we need`, `need an`, and `give her/him/them a`.

**Acceptance-test change.** Turn 1 of the business's acceptance conversation was the bare phrase "corrective action", which went to the knowledge base. Operations has now asked that the bare phrase open the form. So those tests ask "what is corrective action?" instead, and a new block asserts that the bare phrase opens the form.

## 2. "Is payroll deduct applicable?"

The wording is Maddie's, verbatim ("deduct", not "deduction").

| | |
|---|---|
| Template | `dpoa` **revision 4** (`library.ts`, `correctiveActionDocument`). A `checkbox_group` keyed `payroll_deduct` with options `yes` / `no`, placed after Action Plan and before the acknowledgement |
| One answer | New optional `single: true` on `checkbox_group` (`document.ts`). The inline form unticks the other answer, and `enforcePersonEdit` refuses both at once. No other group uses it |
| Starts unanswered | Nothing defaults it. The PDF prints two empty boxes until it's answered |
| Responsibility | `manager`, so the drafting model can't tick it (`enforceResponsibilities` drops it) |
| Reading the chat | `src/lib/forms/payroll-deduct.ts`. It reads statements ("no payroll deduction", "yes payroll deduct applies", "deduct it from her paycheck") in any manager turn. It reads bare replies ("no", "Yes.") only when they answer Ask Sunny's own payroll question: the numbered intake line for that item, or the question asked on its own. The last answer wins. Answers given for an earlier form in the conversation aren't carried over |
| Intake | Added as a required item in `corrective-action-intake.ts`: "Is payroll deduct applicable? (Yes or No)". When the rest has been described, the ready message asks it once, and reads it back once answered. It doesn't block Create draft |
| Continuing the proposal | A bare "no" to the question continues the open CA proposal (`intentForTurn`) instead of going to retrieval |
| Onto the form | The proposal carries `payrollDeduct`. `createInlineForm` sends it, and `POST /api/forms/instances` writes it through `applyStatedFacts` as a manager statement, restricted to this one key and validated against the pinned version |
| After creation | "change payroll deduct to no" / "no payroll deduction" updates the form through `correctActiveForm`, as the manager's own edit. For the CA form this is the only thing chat corrects |
| PDF | The question prints with Yes / No beside it and the chosen box ticked (the existing labelled-group layout in `pdf-render.ts`). Regenerating reads the stored value, so a change shows up |
| Demo data | `src/data/demo/templates.ts` has the matching field |

**Guard for a database that hasn't published revision 4.** The chat asks, reads, and sends the payroll answer only when the *published* CA version has the question (`asksPayrollDeduct` in `form-proposal.ts`). Until revision 4 is live, Ask Sunny behaves exactly as before, and no answer is collected that the form couldn't store.

## Production note: an open draft blocks revision 4

On Ask Sunny Dev (`rbkylaavthsjepsczccv`, which Production reads), the Corrective Action template has an **open draft, version 5**. It was created 23 September 2026, its note is "Cloned from version 4.", and its document is identical to published version 4. `publishSeedRevision` doesn't publish over a draft a person opened, so revision 4 won't go live on its own.

To publish it, either discard that draft (**Forms → Form Templates → Corrective Action Form → Discard draft**), or apply revision 4 through the editor. After a discard, the next Forms or chat read runs `ensureTemplateLibrary`, which publishes revision 4 as the next version.
