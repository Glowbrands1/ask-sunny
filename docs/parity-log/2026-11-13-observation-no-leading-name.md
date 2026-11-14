## 13 Nov 2026: the Observation never starts with the employee's name — Sunny only (OBSERVATION_NO_LEADING_NAME_ENABLED, default off)

QA's Sunny 38d live check: "create a ca for <A> at the front desk, she was rude to a guest" gave the Observation "<A>
at the front desk, she was rude to a guest". With the flag, an account clause that starts with the employee's name and
then "at"/"in" loses the name and keeps every other word (`ai/remap-incident.ts`).

Ask Bubbles: not needed for the name. Checked through its chat route with production's flags (13 Nov 2026, main
6081b825): its card shows an Issue line, not an Observation preview, and the Issue is "she was rude to a guest" — no
name. That Issue does not keep "at the front desk"; reported to QA as a separate question, not changed here.

### WORK_AREA_NOT_A_TITLE (same PR) — Sunny only

The same live turn gave "Job title: Front Desk" for a person not on the roster: the slot model read the work area as
the title and `ai/intent-slots.ts` groundTitle kept it. Ask Bubbles: not needed. Checked through its chat route with the
same scripted reading (13 Nov 2026, main 6081b825): the card has no job title and asks "What is <A>'s position (job
title)?", so "front desk" is never taken there.
