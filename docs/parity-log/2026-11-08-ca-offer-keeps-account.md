# Not flipped here yet: CA_OFFER_KEEPS_ACCOUNT_ENABLED (code in both apps; on in the sibling app's production)

QA's round-6 flag audit (8 Nov 2026): this flag is on in the sibling app's production and was never set here. It
fixes QA's MSB case M5 (5 Nov 2026): "<name> did not follow must see behaviors which violates standards of conduct
policy" → the Corrective Action offer → "yes" made the card read "What happened: The policy is Standards of Conduct"
(the offer's rewritten request read as her account).

Not needed in this app's production today: that card is FORM_FULL_REMAP's "What happened:" card, and
FORM_FULL_REMAP_ENABLED is off here (and in the sibling app). Checked on main 0ae7b2e with production's flags:
`nov5-coding3-ca-offer-yes-keeps-msb-account` is open only because it stubs the full remap on, and the same turns on
production's card, through Create, give the draft "Observed: <name> did not follow must see behaviors." with and
without the flag (guard case `nov8-audit-guards-cases.ts`, `nov8-audit-ca-offer-create-keeps-account`).

Flip it together with FORM_FULL_REMAP_ENABLED if that ever ships here; the case above holds with it.
