## 3 Nov 2026: a date's digits are never a house number — Sunny only (ADDRESS_NOT_PERSON_ENABLED, rolled back in production; fix for QA's review)

QA's live check: with ADDRESS_NOT_PERSON on, "On 10-20-26 <name> was late to
open" and "… on Monday 10/05/2026 <name> was working a shift …" refused the
real name as "a street address": `withAddressNotPerson`
(`forms/person-guard.ts`) read "26 <name>" as a house number. QA set the flag
to 0 in production. Fix: every date the existing date reader
(`datesInText`) finds is blanked before the house-number test, so a date's
digits never count; "123 Main Street" is still an address. Ask Bubbles: not
needed. It has no ADDRESS_NOT_PERSON code.
