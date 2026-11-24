# 2026-11-20 — agent loop: a form asked for somebody else does not close this card at Create

**Stays Sunny-only for now.** Ask Bubbles has no agent loop yet. The change in `lib/forms/proposal-currency.ts` runs
only for the loop's own cards (`isSettledName` given, from `loopCardSettlement`); every other card is read as before.
Rule (c134, Pau OK'd): a later form request counts against an open card only when it is for that card's person or names
no person; the same person asking for another form is still refused. Port with the loop.
