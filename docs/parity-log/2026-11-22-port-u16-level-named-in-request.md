# Ported from Ask Bubbles (#1028, U16): a request that names the level is the level's evidence (22 Nov 2026)

**Sibling app: ported from Ask Bubbles.** Sunny's rules book had no such line. This guides the loop, per Pau's
direction; no code reads the words.

T1 "put up the verbal CA for <P6>", then T2 "create a verbal CA for <P6> with all the same information given". T2's card
said "Warning level isn't set" (level_not_stated), while the saved draft had Verbal. The rules book (one line after the
level-and-payroll evidence line) and propose_form's level_evidence description now say that a request naming the level
("a verbal CA", "create a written") states it, and the model quotes those words. Prompt fixtures were re-taken.

Replay: `nov22-agent-loop-level-named-in-request-cases.ts` (invented Remy Calder). It fails before the port and passes
after.
