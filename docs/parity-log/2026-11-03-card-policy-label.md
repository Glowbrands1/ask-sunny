## 3 Nov 2026: the Policy Violated line cites the card's section — Sunny-only (CARD_POLICY_LABEL_ENABLED, default off)

QA live check, 3 Nov 2026, with NEXT_PUBLIC_CARD_POLICY_TO_DRAFT on: a late
opening's card said "Late Opening Policy p.15" and the draft's Direct policy
quoted Late Opening, but Policy Violated read "Attendance Policy, JBA Policy
Manual p.14" — that line's sections were read again from the account. On,
with the card's section in force, the line cites the sections the quote
cites, the card's first. Not needed in Ask Bubbles: it has no
`required-policy-citation.ts`; its Policy Violated line is the box label with
the cited section beside it (`offenseCategoryValue`), built from the same
ordered sections as the quote, so it already follows the card.
