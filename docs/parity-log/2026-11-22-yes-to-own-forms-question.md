# "Yes" to the loop's own "open <P>'s form on file?" is asking for <P>'s forms (22 Nov 2026, QA's shadow re-run S1(b))

**Sibling app: port to Ask Bubbles** (the same `formsOnFileAskedFor` person check in `agent-loop/tools.ts`, checked at
Bubbles `4fd060f`). Mechanism only.

S1(b): the reply asked "Do you want me to open <First>'s Corrective Action on file?" and the manager's answer was refused
for five turns ("I need you to confirm the person in your own words"). An answer that names nobody counted only an
earlier manager turn that named the person; the app's own question was never read.

Now, when the quoted answer names nobody and the app's reply right before it names this person, the answer is about
them. Sunny's own reply is read, never a list of the manager's words. An answer that names someone else is still that
person's, and a "yes" never opens another person's forms (control case).

Replay: `nov22-agent-loop-yes-to-own-forms-question-cases.ts` (invented Remy Calder). "yes" and "yes please" fail before
the fix and pass after. The control, where the model asks for Juno Paxton's forms after "yes", is refused.

A bare "1" is not covered: evidence quotes need three characters. If the live chat's "1" answered a numbered list, that
is a separate item for QA.
