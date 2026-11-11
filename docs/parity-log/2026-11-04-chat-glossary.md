## 4 Nov 2026: the abbreviation glossary — ported from Ask Bubbles (40146f84, #419) (CHAT_GLOSSARY_ENABLED, default off)

QA's overnight scan, sf-s12: "I need to make a corrective action for msb" made
a card for "Msb" ("I can create a **Corrective Action Form** for **msb**")
and never asked which employee. MSB is Must See Behaviors, the reason for the
form. Pau approved the glossary text byte for byte for both apps; here it is
`CHAT_GLOSSARY` in `src/lib/ai/chat-glossary.ts`, and `chat-glossary.test.ts`
pins it with the expected text written inline — the same string as the
sibling app's `glossary.test.ts`. MSB only.

The source is the sibling app's pull request #419, merged to its main as
40146f84 (the glossary text and test identical to the branch tip 309d1e71).

Where this app differs (name mapping):
- `src/lib/ai/glossary.ts` (sibling) → `src/lib/ai/chat-glossary.ts`: in this
  app `ai/glossary.ts` already exists (the house-terms table,
  `HOUSE_GLOSSARY`, read by retrieval and the form shorthands) and is on the
  flags-off-parity PROTECTED list. Pau's yes covers creating `glossary.ts`;
  here there is nothing to create, and adding the table to the existing file
  would be an edit to a protected module, so it is not edited.
- `keepTypedPerson` (sibling `forms/typed-name.ts`) has no counterpart here:
  every name `readEmployeeMentions` returns already passes `namesSomebody`,
  which `employeeState` / `resolveEmployee` read, so the guard there covers it.
- The same function names elsewhere: `callClaude` (input `glossary`, one
  block just before the question), `server-ask.ts`, `reader/read.ts`,
  `reader/check.ts` (`checkEmployee`), `intent-extraction.ts` (`userBlock`),
  `form-tool-understand.ts` (`conversationText`), `answer-not-a-name.ts`
  (`namesSomebody`), `corrective-action-intake.ts`
  (`readCorrectiveActionIntake`, `correctiveActionIntakeRequest`),
  `form-reducer.ts` (`RefusalReason` `glossary_term`), `form-write.ts`
  (`writeFormEdits`).

With the flag on, the Corrective Action intake asks this app's existing one
question, "Who is this form for? Tell me the employee's full name." — no new
reply text. No system prompt changes; no protected file, UI or database
change. The replay case `nov4-scan-sf-s12-msb-not-a-person` (OPEN in
production) holds with `fixFlags: ["CHAT_GLOSSARY_ENABLED"]` and stays OPEN
with the flag off.
