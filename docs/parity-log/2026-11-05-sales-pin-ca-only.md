# 5 Nov 2026: the sales Standards of Conduct pin is the Corrective Action Form's only — Sunny-only (behind CA_SALES_POLICY_ENABLED)

The flag classification of CA_SALES_POLICY_ENABLED found priority replay s11
failing with the flag on: a Coaching Form for a cell-phone account, after a
turn saying the app "reflected it as underperformance", cited the Standards
of Conduct instead of the Cell Phone/Smart Watch Policy. The pin
(`salesConductOnly`, `src/lib/ai/form-card-slots.ts`) now applies to the
Corrective Action Form only.

**Not needed in Ask Bubbles:** the pin itself is Sunny-only
(`2026-11-05-sales-card-conduct-only.md`); the card's citation step
(`attachFormTurnSources`) does not exist there.
