# coach_team takes the manager's words for the whole team (team_evidence) (22 Nov 2026, QA's shadow re-run S2)

**Sibling app: port to Ask Bubbles** (the same `coach_team` with no arguments in `agent-loop/run.ts` and
`wholeTeamRequest` in `forms/whole-team-coaching.ts`, checked at Bubbles `4fd060f`). Mechanism only; Bubbles' rules
book keeps its own examples.

QA's exact sentence: "can you make me a coahcing form for my entire team at pine lake for selling kits and not writing
raing checks". coach_team answered wrong_tool ("not a whole-team request"): its old phrase reader needs the word
"coaching" spelled one of two ways, and a team phrase from its own list. Pau's rule is to guide the loop, not to grow
word lists. So the model now passes team_evidence (the manager's words asking for the whole team or group), and code
checks only that the words are really in this message (evidence.ts). The phrase reader stays as the fallback. Rules
book and tool description name team_evidence; prompt fixtures were re-taken for that one line.

Tests: replay `nov22-agent-loop-coach-team-evidence-cases.ts`. It covers QA's sentence verbatim (Pine Lake's own
director gets the team card; a Kearney director gets no wrong_tool and no Pine Lake card), five group words the phrase
reader missed, and a control where the quote is not in the message. Each case fails before the fix and passes after.
