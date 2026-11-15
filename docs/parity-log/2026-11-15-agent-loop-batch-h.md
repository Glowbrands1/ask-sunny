# Agent loop batch H (today's behaviors the loop lacked): Ask Sunny only

**Change in Ask Sunny** (QA's batch H, the parity matrix's "AFTER MERGE" gaps; `src/lib/ai/agent-loop/`). Each is
done the loop's way, a fact on a tool's result and a rules-book line, or tool code that fills the card:

- AMOUNT_UNKNOWN_ACK;
- DATE_ANSWER_APPLIED and DATE_ANSWER_KEEPS_OPEN (today's `dateAnsweredIn`, on batch E's dates);
- COACHING_FOR_EVERYONE and WHOLE_TEAM_COACHING (a new `coach_team` tool);
- the job title read back, typed after the name, and spelled out;
- GLOBAL_SALON_ASK;
- MANUAL_NEGATED_LIST_NOTE;
- PLACE_SPAN_GUARD;
- STAFF_PICKER_NO_REPEAT;
- CARRIED_PERSON_NOTICE;
- PASTED_OUTLINE_TO_OPEN_DRAFT;
- TERMINATION_STATED_TICKS.

Shared modules only gained exports, so today's chat path is unchanged: `carriedFromEarlier`,
`spelledOutTitle`/`titleCaseIfLower`, `staffListedBefore` and `asksMustSeeNotConduct`.

**Ask Bubbles: not ported yet** (v2-Coding-5, 15 Nov 2026). Ask Bubbles has no agent loop on its main. Port these with
the loop, on Bubbles' own data (store ↔ salon).
