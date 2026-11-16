# 2026-11-16 — agent loop: the open question record

**Stays Sunny-only for now.** Ask Bubbles has no agent loop yet. The rule this adds: every answer to a question Sunny
asked is applied to that field. Each question a tool result asks (payroll, the level, which date, the exit offer, any
other ask_exactly) is written to the turn's trace as `slots.agent_loop.open_question` (up to 3, one per kind, one-way
keys only), the next turn is told up front (`answering_question`), and the tools read the answer from the record, never
from the reply's text or turn order. When the loop is ported, take `card-record.ts`'s record, `askedQuestion`, the
run.ts plumbing and the prompt fact with it; swap the invented people and the salon/store wording.
