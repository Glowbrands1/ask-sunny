# Loop-card Create: the coaching write-up says what was seen, about the employee (20 Nov 2026)

**Sibling app: not needed now.** Ask Bubbles has no agent loop yet, and this applies only to Create from a loop
coaching card (`cardFromLoop`). Port it with the loop.

Background: Pau's saved-form review, relayed by QA (item 14; the live Test Testy coaching draft). Names in the cases are
invented.

- **Observed** read "Coaching was provided to <name> on …", which describes the coaching, not what was seen. Fix: an
  Observed that describes the coaching itself is the card's account (its "What happened:" line, which the loop checked
  against the manager's words).
- **Expectation** read "Guests are expected to be greeted …", which is about guests, not the employee. Fix: an
  Expectation that does not start with the employee's first name is read from the drafted Going Forward ("<First> will
  greet …" becomes "<First> is expected to greet …"). With no such line it is left as written.
- **Type of Coaching** had a box ticked though the manager named no type. Fix: a box stays ticked only when the
  manager's words hold that option's own label (for example "training plan of action").

`loop-coaching-write-up.ts`. The older chat path (not the loop) is unchanged.
