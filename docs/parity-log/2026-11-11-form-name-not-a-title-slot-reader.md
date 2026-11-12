## 11 Nov 2026: FORM_NAME_NOT_A_TITLE_ENABLED, the slot reader (D5 off-roster follow-up)

**Not needed in Ask Bubbles.**

QA's follow-up to D5 (#833): on main 7b1411ab with D5 live, "Create an SDIT EPP for <name> at IA Altoona" for a person
not on the roster, signed in as an all-salon admin, still showed "Job title: Salon Director in Training". The second
reader is `groundTitle` in `ai/intent-slots.ts`: the slot model reads "SDIT" as the title, and for an off-roster person
a title the manager typed was kept (`readsAsStatedTitle`). Under the same flag, a title word the manager said only
before the form's name ("SDIT EPP", "ASD/SDIT EPP") is not taken from the model (`saidOnlyAsFormName`,
`ai/title-words.ts`); "… she is an SDIT" still is.

Ask Bubbles has the same `groundTitle`, but its slot reader is off in production (INTENT_EXTRACTION and
GROUNDED_ENTITIES), and its forms have no program name made of a job title before "EPP": D5 itself was Sunny-only.
