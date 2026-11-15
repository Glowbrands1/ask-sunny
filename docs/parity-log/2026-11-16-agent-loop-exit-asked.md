# 2026-11-16 — agent loop: an exit card needs an ask (fix batch item 1)

**Stays Sunny-only for now: Ask Bubbles has no agent loop yet.** In the loop (behind AGENT_LOOP_ENABLED +
AGENT_LOOP_USERS), propose_form's exit_evidence now carries its kind (`asks_for_exit_form`, `yes_to_exit_offer`,
`resignation_told`). A resignation told with no ask ("ugh <D> quit yesterday, short staffed again") makes no card and
returns `exit_not_asked` with the offer to ask; a yes right after that offer makes the card. When the loop is ported,
take the mechanism (the kind on the evidence, the offer built from the template's own name) and the replay case
`nov16-fix-batch-exit-asked-cases.ts`, swapping the invented people and the salon/store wording.
