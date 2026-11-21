# Exit form: "immediate voluntary termination" ticks its box; a date's year is checked before Finalize (21 Nov 2026)

**Sibling app: port to Ask Bubbles** (Coding-D copies; QA2, 21 Nov 2026). Both halves are mechanism, no company content.

1. **The loop's exit card carries how the person left.** A real manager's exit form ("Make me an exit form for
   immideate volunatary termination for <P>") ticked no resignation type: the exit form's own reader does not read the
   misspelling. The model now passes `exit_how` (a `resignation_type` option, never the involuntary one) with
   `exit_how_evidence`; the tool keeps it only on that evidence from this request, the card and the reply say it,
   and Create ticks it as the manager's statement only when the quote is in the chat's manager turns (checked
   server-side in `api/forms/instances`). Files: `agent-loop/run.ts` (schema), `agent-loop/tools.ts`
   (`exitHow`, `exitCardTicks`), `agent-loop/rules-book.ts` (one Exit sentence; prompt fixtures re-taken),
   `types/index.ts`, `features/chat/create-inline-form.ts`, `api/forms/instances/route.ts`. Bubbles' exit form is the
   same port (Buff City Soap's exit template key comes from its app config).
2. **"Check the year" before Finalize.** The same form was finalized with "Date that notice was given" 2020-11-20
   (entered by hand on the page). An exit date whose year is more than a year from the form's date shows a warning
   beside it and in the Finalize confirmation; it never blocks. Page-side only.

Replay: `nov21-agent-loop-exit-immediate-voluntary-cases.ts` (her wording, invented name Rowan Kestrel).
