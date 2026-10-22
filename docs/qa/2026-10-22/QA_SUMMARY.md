# Ask Sunny — QA summary for the full release (22 Oct 2026)

Branch `claude/lucid-shannon-v79zju`, pull request #129. All testing used synthetic data. No production or historical HR record was read or changed.

## Fixed (each with a regression test that fails before the fix)
| ID | Defect | Commit |
|---|---|---|
| A | A lower-case name ("my employee pat rivera …") was not read | `dc5e7a6` (port) |
| B | "i already told you" lost the open form | `dc5e7a6` (port) |
| B3 | A reply of only "today" / "yesterday" ended the open form | `555d5e6` |
| C / F-03 | Several incident dates: the form date is chosen by what each date means; Sunny asks "Which date goes on the form?" | `7c4fa18`, `4171a5e` |
| F-03d | "dated 10/20" became part of the employee's name | `2eaf93e` |
| F-01 | A negated or waived payroll deduction was read as Yes (on the branch's ported reader) | `5b208c5` |
| F-01b | Other negations beside an amount ("skip / no need for / hold off on the $25 payroll deduction") | `9e84273` |
| F-01c | The Action Plan printed "$25, will be deducted…" | `16b2836` |
| F-01d | A withdrawn Yes stayed on the card | `771466e` |
| F-01e | After the form existed, "we cancelled …" or an unclear statement left a Yes; now No, or the answer is cleared and asked. A finalized form is corrected on a new draft | `880d19a` |
| F-02 | A reply naming a salon replaced the employee | `8ae0147`, `1ebbf60` |
| F-04 | "write a …" was read as a Corrective Action request | `38f9290` |
| F-05 | Times, prices and quantities after "at" were read as salons | `de490a3` |
| F-06 | Two people in one request: one was picked silently | `b24882e` |
| F-07 / F-08 | Earlier coaching not recognised in natural phrasing; false escalation | `23b285a` |
| F-09 | A role or relationship before the name hid the employee | `d0e197a` |
| F-11 | Prior forms matched by name across salons; now attached only when the name is one person at this salon | `7ef0e1a`, `d52a3fa` |
| F-12 | Answering "Which salon is this about?" ended the open form | `1ebbf60` |
| F-13 | Names were capitalised; the manager's spelling is now kept | `cf8bdd6` |
| X2 | "no, keep it verbal" did not take the warning level back | `4ee4c1b` |
| 306/307/314 | For an account covering every salon, a typed ambiguous number was dropped without a question; now asked between the two salons | `bee01d6` |
| UI-T | Two chat-screen test files timed out by chance (test timing only; no assertion changed) | `52fceb0` |
| LS-1 | A local-database test failed after the Woven access tests (test cleanup only; no assertion changed) | `b9fe177` |

Ports from the sibling app (mechanism only, Sunny's own data) are listed in `docs/parity-log.md`.

## Changed test expectations
- **Names kept as typed:** expectations restored to `main`'s (the owner's 22 Oct decision).
- **"Jane Doe at 373":** now names no salon (a branch-only file).
- **UI-T and LS-1:** timeout and cleanup lines only.

No assertion was deleted, skipped or loosened. There is no `.skip`, `.only` or `.todo`.

## Release decisions
See `RELEASE_DECISIONS.md`.

## Not in this release
- **R1:** a lower-case name in "…what should I do?" gets no form suggestion. This is the deliberately conservative name reader; it is deferred.
- **F-10:** district and region managers cannot file until verified assignments exist (fail-closed).
