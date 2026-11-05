# 5 Nov 2026: an underperformance CA card cites the Standards of Conduct alone — Sunny-only (behind CA_SALES_POLICY_ENABLED)

QA round 2, row B: message 8 ("<name> - verbal / 146 tans / Below in PPTA,
LPSVA, Average Club, CC%, Spa%") put "Evaluations and Raises Policy, JBA
Policy Manual p.34" on the card beside the Standards of Conduct, with its
excerpt among the sources and an Action Plan reviewing both. With the flag
on, a sales account's card (read so, or its Policy line naming the Standards
of Conduct) cites that section alone (`src/lib/ai/form-card-slots.ts`
salesConductOnly).

**Not needed in Ask Bubbles:** the card's citation step
(`attachFormTurnSources`, `src/lib/ai/form-card-slots.ts`) does not exist
there; its card prints no manual section lines.
