# The new QA's first message

Paste this as the first message of the new QA session on the new account (repository `Glowbrands1/ask-sunny`).

```
You are the new QA for the Ask Sunny AI agent loop ("QA Success 2"), taking over from the QA on Pau's old account. Your scope is the AI loop only (see "Scope" at the top of HANDOFF.md); the rest of Ask Sunny and Ask Bubbles are not your job unless Pau says so. For the loop, you are the only session that merges pull requests, changes Vercel environment variables or redeploys. Coding sessions write code and open draft PRs only; testers run replays and live tests and report. Never touch SELF_CHECK_ENABLED.

Do not merge, change a flag or redeploy until step 4 is done and Pau has answered.

0. The handoff files are on branch claude/agent-loop-handoff (PR #1046, not merged yet): git fetch origin claude/agent-loop-handoff and read them from there.
1. Read CLAUDE.md, docs/agent-loop/HANDOFF.md, docs/agent-loop/rebuild-plan.md, docs/agent-loop/SESSION_STARTERS.md and docs/agent-loop/handoff-inventory.md.
2. Verify HANDOFF.md against gh and git, and list every difference:
   - git fetch origin; the main SHA, and that main contains the 14 loop merges in HANDOFF.md section 3 (git log origin/main).
   - gh api "repos/Glowbrands1/ask-sunny/pulls?state=open&per_page=100" (all pages): every open agent-loop PR is in section 2 or the inventory, with the same head SHA, base and draft state.
   - git branch -r: the WIP branch claude/wip-runner-harness exists in ask-sunny, and claude/wip-testers in the Ask-bubbles repository (the Sunny live-test helpers).
   - Vercel project ask-sunny: the production deployment, its git SHA, login 200, runtime errors in the last hour (names of env vars only; never decrypt values). AGENT_LOOP_ENABLED and AGENT_LOOP_USERS exist.
   - CI on the deployed main SHA.
3. Open every session in SESSION_STARTERS.md under yourself, in its order: Coding-7, Coding-A, Coding-B, Coding-5, Runner, Coordinator with Tester-Sunny. Start Coding-5 only when the pilot begins (PR 2b). Tell Coding-A and Coding-B to wait for Pau's "fix batch go" before writing code.
4. Report to Pau, in plain words and PH time:
   - the session list (name, new session id, role, current task),
   - every difference you found in step 2,
   - the open questions in HANDOFF.md section 9,
   and end with "What you need to do:" and where we left off.
5. Only then continue the pilot checklist in HANDOFF.md section 6, from "What I would do next".
```
