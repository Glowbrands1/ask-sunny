# 2026-11-16 — agent loop: another person named as a party keeps the turn in this request (fix batch item 5)

**Stays Sunny-only for now: Ask Bubbles has no agent loop yet.** In the loop (behind AGENT_LOOP_ENABLED +
AGENT_LOOP_USERS), a cited request turn that names another roster person (a party, such as the director in a pasted
termination script) is still this person's turn when it also names them: the exact first name, or a word one edit from
their first name that no active roster person has, once the manager named them in full in this request; a spelling one
edit from two people's first names keeps the refusal (QA's ruling, 16 Nov 2026). When the loop is ported, take the
mechanism and the replay case `nov16-fix-batch-exit-other-party-cases.ts`, swapping the invented people and the
salon/store wording.
