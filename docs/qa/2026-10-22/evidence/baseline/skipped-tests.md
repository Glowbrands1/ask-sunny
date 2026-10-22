# Skipped tests in the full suites (baseline, run alone)

Baselines: Sunny 9548afb (12 skipped files, 131 skipped tests); Bubbles ce03a64 (6 skipped files, 59 skipped tests).
None of the skipped files differs between origin/main and the branch (`git diff --quiet origin/main HEAD -- <file>` for every one).
All skips are environment-gated (`describe.skip` / `skipIf` on an env var or a local file); none is a `.skip` written into a test.

## Bubbles (59 = 13 + 13 + 1 + 12 + 1 + 1 + 1 + 17)
| File | Tests | Gate | HR workflow? |
|---|---|---|---|
| lib/auth/revocation.local-stack.test.ts | 13 | local Supabase stack | access (run in integration step) |
| app/api/forms/pm-framework-original.isolated.test.ts | 13 | PERFORMANCE_FRAMEWORK_ORIGINAL_PATH (source document not in repo) | **yes** — framework grounding for HR form drafting |
| lib/employees/woven/live-probe.dry-run.test.ts | 1 | live Woven credentials | no |
| lib/employees/woven/access/access.local-stack.test.ts | 12 | local Supabase stack | access (run in integration step) |
| lib/knowledge-sync/woven/bcs/jba-handbook.live-verify.dry-run.test.ts | 1 | live Woven | policy manual sync, indirect |
| lib/knowledge-sync/woven/bcs/live-dry-run.dry-run.test.ts | 1 | live Woven | no |
| lib/knowledge/framework-readiness.test.ts | 1 of file | RUN_CORPUS_READINESS=1 + live Supabase | **yes** — framework availability |
| lib/knowledge/performance-management-role.test.ts | 17 of file | PERFORMANCE_FRAMEWORK_PATH | **yes** — framework role grounding |

## Sunny (131)
Same framework gates (performance-management-role 17, framework-readiness 4), plus local-stack (adoption 11, revocation 13, access 12, lifecycle 26, reviews 8+8), reporting dry-runs/workbooks (bed-spa 8, real-workbook 7, sales-totals 1, spa-engagement 9, spa-wellness 6) and Woven live probe 1.

Environment blocker: the Performance Management Framework source document is not available in this environment, so the framework-grounding tests cannot run here. The Corrective Action flow itself is covered by non-skipped e2e suites (hr-feedback-oct21*, corrective-action-*-e2e).
