# 2026-11-20 — agent loop: a promised follow-up gets a follow-up date

**Stays Sunny-only for now.** Ask Bubbles has no agent loop yet (checked at Ask-bubbles `7c92054`: no
`src/lib/ai/agent-loop/`, and its Create and drafting routes have no `fromAgentLoop` / `cardFromLoop`). Rule this adds
(Pau, 20 Nov 2026): a Corrective Action the loop creates, and any loop form whose drafted plan or the manager's own words
promise a follow-up, gets `follow_up_date` = the date the manager stated, else the form date + 7 days (today + 7 when that has passed), through
`setFollowUpDate` (`follow-up-default.ts`, `follow-up-default-write.ts`); the card says "Follow-up: <day> (change it
anytime)."; `edit_form` takes `follow_up_date` ("change the follow up to 12/3", "move the follow up to next Friday") and
never refuses one for being after today. Port with the loop (salon ↔ store; Bubbles' corrective form key from its app
config).
