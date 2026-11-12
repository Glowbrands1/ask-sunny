# Ask Sunny only: a chained made-about turn never keeps the old reference (MADE_ABOUT_POLICY_LINE_REPLACES_ENABLED)

**The finding.** QA's live Sunny round 15 (10 Nov 2026) ran two made-about turns in a row:

1. "I need you to make it about showing up late" wrote "Policy reference: Attendance Policy, JBA Policy Manual p.14".
2. "make it about leaving the front desk unattended on 11/6/26" then saved "Policy reference: Standards of Conduct Policy, JBA Policy Manual p.13; Attendance Policy, JBA Policy Manual p.14".

**The cause.** The second revision kept the first turn's line in a shape the splitter does not read as the app's own: with a trailing period, or not as the last paragraph. So the old line stayed in the account and was read into the new reference.

**The fix.** With the flag on, `made-about-policy-line.ts` removes every "Policy reference: …" line from the rewritten account before reading its reference again.

**Not needed in Ask Bubbles.** That app has no MADE_ABOUT_POLICY_LINE: a made-about rewrite there writes no policy reference, so there is no old line to keep. See `2026-11-09-made-about-policy-line.md`. Port this together with MADE_ABOUT_POLICY_LINE when POLICY_CITATION is turned on there.
