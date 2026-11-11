## 11 Nov 2026: LATE_CARD_AGREES_ENABLED stays Ask Sunny only

QA, Sunny live (r22 + r26, dpl_7Uakw6iR): "create a CA for <roster person, lowercase>, she was late on 11/3/26" once
replied "Policy: Attendance — read from this request." while the card cited Late Opening p.15 and its Action Plan
reviewed the Late Opening policy. Here the reply reads the manager's words (LATE_READS_ATTENDANCE) and the card the slot
model's heading; the flag puts the card on the reply's reading.

Ask Bubbles was checked on `main` 5da5c430 through the real chat route, production's flags, the same wording with a
lowercase roster name, and the slot model's heading Late Opening, Attendance and none: every run reads "**Policy:**
Attendance, from what you described ("late") — … page 14" with its Action plan on the Attendance policy. Bubbles reads
the card's policy from the manager's words, not the heading (it has no `ai/form-card-slots.ts`), so the three agree.
Not ported.
