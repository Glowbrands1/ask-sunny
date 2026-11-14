## 11 Nov 2026: OTHER_POLICY_AGREES_ENABLED and OTHER_NOT_A_POLICY_NAME_ENABLED stay Ask Sunny only; ACCOUNT_TYPOS_FIXED_ENABLED is ported

The Sunny sanitation report (10 Nov 2026 18:49Z, 1 star): "please make a ca for <name> for not doing th e10 minute
sanitaion". The card cited Care and Cleaning p.21, Create saved Policy Violated "Other" with the emergency passage, and the
Action Plan said "review the Other policy".

Ask Bubbles was checked on `main` 37dc1b8 through the real chat route with production's flags, the same wording and an
invented person, with and without the slot model reading the heading "Care and Cleaning of Equipment and Facilities":

- A1 (card and draft disagree): the card states no policy and cites no page, and the draft saves no Policy Violated, no
  Direct policy and no offense box. Nothing disagrees, so it is not ported. The mechanism (`cleaningUndonePatterns` in
  `forms/ca-policy.ts`, the Other branch in `ai/form-card-slots.ts` and `forms/policy-fields.ts`) ports as is if Bubbles
  starts reading sanitation as Other.
- A2 ("the Other policy"): the Action Plan reads "review the applicable company policy". Not ported, for the same
  reason.
- C (typos on the card): the same slip shows on Bubbles' **Issue:** line. Ported as ACCOUNT_TYPOS_FIXED_ENABLED
  (Ask Bubbles branch `claude/other-policy-agrees`).
