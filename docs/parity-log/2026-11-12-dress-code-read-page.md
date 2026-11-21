# 2026-11-12 — the read-from-request Dress Code line's page (Bubbles-only for now)

**Bubbles (QA's 17m live test):** "Policy: Dress Code — read from this request." had no page. Bubbles' POLICY_PAGE_ON_CARD
step now also reads that line: "Dress Code (JBA Policy Manual p.15) — read from this request."

**Here:** the same line has no page either. This app has no POLICY_PAGE_ON_CARD step; a card's page comes only from the
named-policy lookup in `ai/form-proposal.ts` (protected). QA's decision (12 Nov 2026): leave the page off for now, and do
not touch `form-proposal.ts` for it. If it is wanted later: let `namedPolicyFor` ground a `readFromApp` reading to its
manual section (as it grounds a missed meeting), with the owner's sign-off, or port Bubbles' page step as its own flag.
