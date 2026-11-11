## 3 Nov 2026: "Same coaching listed twice in prior actions" (replay set sf-s6) — closed as two genuine forms, no change

One of sf-s6's reported failures was the same coaching appearing twice in the
card's prior actions. The 2 Nov investigation (`docs/parity-log.md`, the
new-request-turns entry) found two forms really signed the same day with
identical lines: data, not a duplication bug. A unit test already covers
same-day forms read as two steps
(`src/app/api/forms/qa-w3-prior-forms-identity.test.ts`). QA, 3 Nov 2026:
closed as "genuine two forms", no new replay case (the pack runner stubs prior
forms) and no code. sf-s6's other symptom (a redraft replacing the
observation) is nov2-p1a/p1b, already fixed. Nothing to port.
