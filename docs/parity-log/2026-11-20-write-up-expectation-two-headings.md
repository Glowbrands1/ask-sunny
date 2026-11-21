# Loop-card Create: the Expectation is filled and the name stays the first name (20 Nov 2026)

**Sibling app: not needed now.** Ask Bubbles has no agent loop yet, and this applies only to Create from a loop card
(`cardFromLoop`). Port it with the loop.

Background: QA's live test of #1154 (f075). The manager typed "ca for <P>, not in dress code, no name tag and no
goal sheet", and the card cited two headings. The saved Observation had an empty Expectation. The expectation
sentence sat under Going Forward, and the write-up switched from the first name to the full name.

Nothing in the save path moves a sentence between sections. So the drafter itself wrote it that way, and the replay
case scripts the drafter to match the saved text. The repair (`loop-write-up-sections.ts`) runs on the loop card's
drafted write-up, never on the manager's words:

- The full name becomes the first name.
- An empty or missing Expectation takes the "<First> is expected to …" sentence from another heading (moved, never
  copied). If there is none, it is built from Going Forward's "<First> will/should X".
- A Going Forward left empty is dropped.

A write-up with nothing to move keeps its own layout.
