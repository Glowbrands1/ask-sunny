# Two staff share a first name: the which-one question never stalls (23 Nov 2026, port of Ask Bubbles #1081, A9)

**Sibling app: ported from Ask Bubbles** — taken from #1081's PR head `fdb5db0d3` before it merged. Mechanism only.

Bubbles' tester (A9, admin/global) gave a first name two active staff share. The which-one question was right, but the
manager answered "yes", gave the account, then "yes, do that": the full question came back every turn and no card was
built. Sunny's loop has the same `findStaff` path.

Now:

- `find_staff` records the question it asks (`effects.nameQuestion`: the people offered and the name typed) and gives the
  model `ask_exactly`; once the same people were offered and the answer picked nobody, it gives a short question and
  `asked_before`.
- `confirmsIn` (confirmed-spelling.ts) reads an answer to a several-people question: a surname only one offered person
  has, or a salon only one offered person works at, picks that person. The salon is read with `readSalonMentions`, then
  with the parts of each offered person's salon name that no other offered person's salon shares (Sunny's salon names
  lead with the state, "NE Lincoln O Street", so the parts differ from Bubbles' "Bellevue, NE"). No word list.
- `findStaff` settles a several-people lookup when the latest turn confirms exactly one of them, and tells the model to
  propose the card at once with the account from the earlier turns.
- One rules-book line (new in Sunny: it had no copy of Bubbles' 21 Nov which-one line): ask once, never say anything is
  kept on a card that does not exist, no pronoun for an unsettled person. Prompt fixtures re-taken.

Replay: `nov23-agent-loop-same-first-name-no-stall-cases.ts` (invented Lorcana Tamberlin / Lorcana Delacroixe): answer by
surname and by salon build the card with the account; the control ("yes", the account, "yes, do that") builds no card and
the repeat is short. All fail before the fix and pass after (stand-in only; skipped under the live harness).
