# Exit card: the reader's type wins over exit_how, so card, reply and saved form agree (21 Nov 2026)

**Sibling app: port to Ask Bubbles** with #1197's exit_how (Coding-D). Mechanism only.

QA2's live check of #1197: "<A> quit without notice" (the exit form's reader ticks Immediate Voluntary Resignation,
said in the reply), then "…I didn't come in, I'm actually going to resign…": the model passed exit_how no_call_no_show
and the card carried it, so Create would tick a type the reply never said. `agent-loop/tools.ts` now carries exit_how
only when the reader ticks no type for the request (`readerTypeTicked`). Replay:
`nov21-agent-loop-exit-how-one-decision-cases.ts` (QA2's three turns, invented names).
