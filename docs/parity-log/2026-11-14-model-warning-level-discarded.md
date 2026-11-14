# The Type of Warning is the manager's, never the draft model's (MODEL_WARNING_LEVEL_DISCARDED_ENABLED)

**Change.** QA's 38g live test (14 Nov 2026): a Corrective Action asked for with no warning level ("please make a ca for
<B> for not doing the 10 minute sanitation on 11/12/26, she was told twice") was saved with Type of Warning Written,
ticked by the draft model. The draft route showed the model the Type of Warning group and wrote its tick whenever the
manager stated no level. With the flag on (default off), the group is not shown to the draft model and a Verbal /
Written / Final level it ticks anyway is dropped; a level the manager stated is ticked at creation from the card and
kept. Read-only check of the last 30 days: 27 CAs had an AI-filled level; on none of the 21 with a card had the app
read a stated level.

**Ask Bubbles: already there.** Ask Bubbles has done this unflagged since 9 Oct 2026 (its draft route, "THE TYPE OF
WARNING IS THE MANAGER'S, NEVER THE MODEL'S": the group is left out of the prompt, `withoutModelWarningLevel` drops the
model's level, and the box is filled only from the manager's words). This is the port of that mechanism to Ask Sunny,
which never received it.
