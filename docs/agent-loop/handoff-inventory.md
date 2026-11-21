# Handoff inventory (AI loop only)

Generated 15 Nov 2026 by the outgoing QA from `gh api repos/Glowbrands1/ask-sunny/pulls?state=open` (all pages)
and `git branch -r`, filtered to the AI agent loop. Every other open PR and branch in Ask Sunny, and everything in
Ask Bubbles, is outside this handoff (Ask Sunny had 178 open PRs and 1099 remote branches in total).

## Open agent-loop pull requests

| PR | Draft | Base | Branch | Head | Updated | Title |
|---|---|---|---|---|---|---|
| #1046 | True | `main` | `claude/agent-loop-handoff` | latest | 2026-11-15 | Docs: QA Success 2 handoff for the agent loop |
| #1015 | false | `main` | `claude/termination-design-doc` | `8cd55154` | 2026-11-15 | Docs: terminations in the agent loop (the model decides, code locks) |
| #1005 | false | `main` | `claude/start-here-oy5rn6` | `af65343d` | 2026-11-15 | Parity log: the agent loop's Ask Bubbles port list (docs only) |

Also: `claude/wip-testers` in the Ask-bubbles repository (`0ad4b8f3`) holds the Sunny live-test helper scripts.

## Agent-loop remote branches

All merged or superseded except `claude/agent-loop-handoff` (#1046) and `claude/wip-runner-harness` (Runner's harness, no PR). Safe-to-delete candidates named by their owners: `claude/agent-loop-pr1b-evidence-gates`, `claude/agent-loop-batch-k-propose`, `claude/agent-loop-batch-k-team`, and every merged branch in HANDOFF.md section 3. Do not bulk-delete without Pau.

- `claude/agent-loop`
- `claude/agent-loop-app-config`
- `claude/agent-loop-batch-a`
- `claude/agent-loop-batch-b`
- `claude/agent-loop-batch-c`
- `claude/agent-loop-batch-d`
- `claude/agent-loop-batch-e`
- `claude/agent-loop-batch-f`
- `claude/agent-loop-batch-g`
- `claude/agent-loop-batch-g2`
- `claude/agent-loop-batch-h`
- `claude/agent-loop-batch-j`
- `claude/agent-loop-batch-j-keep`
- `claude/agent-loop-batch-k`
- `claude/agent-loop-batch-k-gate`
- `claude/agent-loop-batch-k-keep`
- `claude/agent-loop-batch-k-propose`
- `claude/agent-loop-batch-k-team`
- `claude/agent-loop-card-honesty-hotfix`
- `claude/agent-loop-code-audit`
- `claude/agent-loop-data-tools`
- `claude/agent-loop-evidence`
- `claude/agent-loop-g4-single-out`
- `claude/agent-loop-handoff`
- `claude/agent-loop-parity`
- `claude/agent-loop-pr1-evidence-args`
- `claude/agent-loop-pr1b-account`
- `claude/agent-loop-pr1b-evidence-gates`
- `claude/agent-loop-pr1c-level-payroll`
- `claude/agent-loop-pr2-reply-claims`
- `claude/agent-loop-pr4-reason-codes`
- `claude/agent-loop-saved-diff`
- `claude/agent-loop-shadow`
- `claude/agent-loop-test-harness`
- `claude/agent-loop-wip`
- `claude/start-here-oy5rn6`
- `claude/termination-design-doc`
- `claude/wip-runner-harness`
