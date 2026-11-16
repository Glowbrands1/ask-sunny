# 2026-11-16 — agent loop: never guess a pronoun, or a form from pasted text

**Stays Sunny-only for now: Ask Bubbles has no agent loop yet.** Two rules-book lines in the loop (behind
AGENT_LOOP_ENABLED + AGENT_LOOP_USERS): never guess a pronoun for an employee (their name, or "they", unless the manager
used one); text the manager pasted with no ask of their own (a meeting script, a letter, notes) gets a one-line summary
and ONE question, never a promised form, level or termination. When the loop is ported, take both lines and the replay
case `nov16-agent-loop-no-guessing-cases.ts`, swapping the invented people and the salon/store wording.
