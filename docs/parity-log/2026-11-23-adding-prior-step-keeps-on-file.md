# Adding a prior step never removes the forms on file from the card (Ask Bubbles #1069, 51a2dda7, its QA's live regression set, A13 item 9) — ported

**Report (Ask Bubbles' live set):** on a Corrective Action card whose Prior actions were filled from the forms on file,
T4 "in the previously recieved coaching include that <P> signed the jba policy manual on 10-15-26" came back with the new
coaching step only: the model listed just that step, and the Corrective Action on file left the card. QA's ruling: adding
never removes.

**Ask Sunny: same gap.** Sunny's propose_form read `keptPriorActions ?? (statedSteps.length === 0 ? onFileLine : null)`
(main daa2b3c): a kept model list replaced the on-file line.

**Port (the mechanism; names invented):** `agent-loop/tools.ts`, propose_form's Prior actions. With this person's card of
this form on screen (`samePersonOnScreen` and the same template), the forms on file stay beside the steps this request
adds; a form on file whose date a kept step already has is that step, listed once. Read from the forms' own dates, never
a word list.

**Tests:** replay `nov23-agent-loop-adding-prior-step-keeps-on-file-cases.ts` (the tester's four turns word for word, the
person invented, Remy Calder): `nov23-a13-adding-prior-step-keeps-on-file-line` fails on main in both flag modes and
passes after; the control `nov23-a13-control-on-file-step-restated-listed-once` passes before and after.

**Overlap with Sunny #1239 (open):** #1239 adds `listedWithKeptSteps` (steps listed beside a kept step) and
`accountWithoutPriorSteps` after this point. Bubbles applies the on-file line after its own listed steps; this port puts
the on-file forms before the kept list, so when #1239 merges, the listed steps join the kept list and the on-file forms
stay in front of both, as in Bubbles. The merge touches the same few lines in proposeForm.

**Live:** not run here (QA runs live tests).
