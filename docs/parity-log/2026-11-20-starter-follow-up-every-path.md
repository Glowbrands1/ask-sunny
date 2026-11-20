# 2026-11-20 — the starter follow-up example on every path, whatever the who-question's words

**Sibling app: port with the first change (2026-11-20-starter-follow-up-example.md).** QA's live re-test of #1127: the
who-question was matched too narrowly, the coaching-conversation chip was not keyed, and the agent loop never ran the
step. Now every home starter answered with a who or which question is keyed (a table in `ai/starter-follow-up.ts`), the
who-question is any "Who is this / it … for …?" sentence, bold or not, and the agent loop runs the same step
(`starterExampleText` in run.ts). Ask Bubbles: its own starters and store wording; the loop part waits for its loop.
