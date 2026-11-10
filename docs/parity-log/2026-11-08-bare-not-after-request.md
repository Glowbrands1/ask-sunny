# Sunny-only: BARE_NOT_AFTER_REQUEST_ENABLED (the sibling app holds without it)

QA's round-6 flag audit (8 Nov 2026): live here since flip 9, no code in the sibling app. "ca for <A> not late" asked
nothing here (6 Nov 2026), because the clause starts with the request.

Not needed in the sibling app: its main (e7a7ba9c) with its production flags, run with this app's five cases
(`nov6-bare-not-after-request-cases.ts`, store wording): all hold. Its DENIAL_NO_ACCOUNT_ENABLED (live there) takes
an Issue that only denies a fault off the card, so the card asks what happened. Guard cases are in the sibling app's
pack (`nov8-audit-guards-cases.ts`).
