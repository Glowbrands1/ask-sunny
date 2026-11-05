# 5 Nov 2026: a Coaching Form gets no sales reading — Sunny-only (behind CA_SALES_POLICY_ENABLED)

QA's ruling on priority replay s11's second line: a Coaching Form does not
get the sales reading, and a turn complaining about the app is not an
account of the employee. `attachFormTurnSources` (`src/lib/ai/form-card-slots.ts`)
reads the turns with the sales reading held (`withoutSalesReading`,
`src/lib/forms/ca-policy.ts`) for any card but the Corrective Action Form.

**Not needed in Ask Bubbles:** the card citation step does not exist there,
and the same conversation in its words (replay case
`nov5-coaching-cell-phone-no-sales-reading`, added there as a guard) cites
no Standards of Conduct on the card or the draft with the flag on.
