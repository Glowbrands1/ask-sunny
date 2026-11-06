# Sunny-only: a bare "not late" is a denial, not the account (BARE_NOT_DENIAL_ENABLED)

QA's Sunny gate (6 Nov 2026, bb09c0f5) found that with CA_SALES_POLICY_ENABLED on, the omission-is-account control "not late" drafted a Corrective Action instead of "You haven't told me what happened yet": the denial reader knew "never late" / "wasn't late", not a clause starting with a bare "not". With the flag on, "not <fault word>" at the start of a clause is a denial too (the fault words are the reader's own); "not meeting sales requirements" stays an account.

Not needed in the sibling app: it has no CA_ASKS_WHAT_HAPPENED path, so it never asks "what happened" for a Corrective Action, and "create a corrective action for <name>, not late" drafts the same card there with CA_SALES on or off (checked on its main a9a52b2c with production's flags). Nothing regressed there. If the sibling app later takes the what-happened ask, this denial reading goes with it.
