# 5 Nov 2026: two card fixes with no counterpart in Ask Bubbles — Sunny-only

Pau via QA:

- sf-s25, CARD_POLICY_DESCRIBED_ENABLED: a closing account's card cited
  "Late Opening Policy, JBA Policy Manual p.15", the intent read's stored
  heading. On, a heading read only from the stored "Policy reference:" line is
  cited only when the manual's described-section table supports it in the
  manager's own words (`src/lib/ai/form-card-slots.ts` cardManualHeading,
  `src/lib/forms/official-policy-manual.ts` wordsSupportHeading).
- sf-s22, NEW_PERSON_OWN_WORDS_ENABLED: "It needs to be a CA" behind the
  stored state read as a new request for another person, and the card lost
  its account. On, `src/lib/ai/new-person-request.ts` reads the manager's
  own lines.

**Not needed in Ask Bubbles:** neither the card's citation step
(`form-card-slots.ts`) nor `new-person-request.ts` exists there; its card
prints no manual section line and no Observation. The sf-s25 and sf-s22
twins hold there on what they assert.
