# Sunny-only: TITLE_NOT_IN_OBSERVATION_ENABLED ("she is an HR assistant" stays out of the Observation)

QA's October triage of #207 (B16, 10 Nov 2026): "create a coaching form for <employee> at Kearney, she is an HR
assistant, for being late on 10-20-26" gave a Coaching card whose Observation of Offense was "she is an HR assistant,
being late on 10-20-26". With the flag, a clause that only states the employee's job title is left out of the
Observation (`ai/title-not-in-observation.ts`, in `remap-incident.ts` managerAccount).

Not needed in the sibling app (checked on its main 37dc1b8a with the replay harness and its production flags, 10 Nov
2026): its Coaching card shows no Observation line and sets no Issue, so the title never reaches a card. Its sibling of
#167 ("write up <employee> for cell phone use" as the CA Issue) is a real bug there and is ported as
WRITE_UP_LEAD_NOT_ACCOUNT_ENABLED (branch claude/write-up-observation-rebuild).
