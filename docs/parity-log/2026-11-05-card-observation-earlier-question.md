# 5 Nov 2026: the card's Observation is the incident, not an earlier question or the payroll answer — Sunny-only halves

Pau via QA:

- sf-s25: "What policy would it be if …", asked before "Write a CA for …",
  began the card's Observation of Offense. OBSERVATION_NOT_EARLIER_QUESTION_ENABLED
  reads the account without the turns before the latest request that were
  questions to answer (`src/lib/forms/earlier-questions.ts`, applied in
  `src/lib/ai/keep-filled-slots.ts`).
- sf-s23: "not pay roll deductable" was the Observation. With
  PAYROLL_ANSWER_SPELLING_ENABLED a sentence that only answers the payroll
  question is left out of it (`keep-filled-slots.ts` onlyAPayrollAnswer).

**Not needed in Ask Bubbles:** its card has no Observation of Offense line
(`keep-filled-slots.ts` does not exist there); the twins
`nov5-twin-sf-s25-closing-no-late-opening-claim` and
`nov5-twin-sf-s23-payroll-answer-and-policy-change` hold there. The reader
half of PAYROLL_ANSWER_SPELLING_ENABLED is ported (Ask Bubbles
eb7c9f9b3e4f6f191d843f7d084542e5d798045f).
