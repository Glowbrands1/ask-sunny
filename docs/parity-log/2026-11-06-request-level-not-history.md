# 6 Nov 2026: a level asked for in the request's own clause is this form's — sibling app only; guards here

QA item 6 (found in the sibling app): "I need to write up <name> with a written
warning for leaving the front desk unattended for 30 minutes on 10/22. There's
no prior coaching on file." was answered there "I've treated the earlier warning
you mentioned as previous corrective action history" and asked the level again:
its warning-level reader read the requested level as history because the
incident's date followed it. Fixed there behind REQUEST_LEVEL_NOT_HISTORY_ENABLED.

**Not needed here:** this app's `src/lib/forms/warning-level.ts` never writes the
earlier-warning line and treats a level as history only when a history verb,
label or heading comes with the date. The same wording already holds with
production's flags. Guards only: the replay cases in
`src/app/api/chat/replay-pack/nov6-coding3-request-level-not-history-cases.ts`
and the unit guards in `src/lib/ai/warning-level-invented-oct24.test.ts`. No
flag here (QA: a flag that changes nothing confuses the gate).
