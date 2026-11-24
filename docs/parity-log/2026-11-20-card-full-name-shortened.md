# The card's person by first name, not the full name (QA, 20 Nov 2026; live on main b06e51be)

**Sibling app: not needed now.** Every change is on the agent loop's path: the loop card's account (`propose_form`),
the loop's final reply (`run.ts`), and the saved write-up of a Create from a loop card (`cardFromLoop`). Ask Bubbles has
no agent loop yet; port `src/lib/forms/short-name.ts` and its three call sites with the loop.

"ca for Test Testy, late 11/18" got "Here's the Corrective Action Form for **Test Testy**", "Observation of Offense: Test
Testy was late on 11/18", and a saved Observed of "Test Testy was late to work on November 18, 2026." The model had
written the full name, and code only named the person where the model wrote a pronoun. Now the reply name
(`replyNameFor`) takes the full name's place on the card's account and in the reply, except on the lines that confirm
which person it is (bold, or a question). The saved write-up's prose fields use the first name. Not caused by #1175, which
changes only the post-draft note.
