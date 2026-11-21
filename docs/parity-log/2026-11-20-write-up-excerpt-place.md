# Loop-card Create: Direct policy quotes the passage that fits the offense; no invented place (20 Nov 2026)

**Sibling app: not needed now.** Ask Bubbles has no agent loop yet, and both changes apply only to Create from a loop
card (`cardFromLoop`). Port them with the loop. The passage choice reads the pinned manual's own rows, so it ports as
is.

Background: QA's live check of the Test Testy draft (items 16 and 17). Names in the cases are invented.

**16. Direct policy.** A card citing "All Locations Dress Code" p.15 for a mini-skirt account quoted the NAME TAGS
paragraph, which is the first thing under that heading.

- Fix (`account-passage.ts`): the cited heading's text runs until the manual's next titled section. The block that
  shares the most words with the card's account is quoted, verbatim.
- When no block matches, the general rule printed above the heading is quoted instead ("… neat, clean, professional
  appearance … proper work attire …").
- The cases use production's dress code rows. The All Locations section has no skirt rule. Skirt wording appears only
  under the JB & Associates Office section (p.17), which is not the cited heading.

**17. Invented place.** The write-up added "at the salon", which the manager never said.

- Fix (`unsaid-place.ts`): "at / in the <salon>" is taken out of the saved text when the manager's words never use that
  noun.
- The drafting rules' own example ("was observed wearing a mini skirt at the salon", `policy-claim-guard.ts`) is the
  likely source. That example is shared with the older path and is left unchanged here.

The older chat path (not the loop) is unchanged.

**18. Direct policy with no wording.** QA's production audit: "I need the JBA policy for dress code enclosed"
finalized a Direct policy that held only "Source: JBA Policy Manual — All Locations Dress Code, p. 15".

- Cause, as reproduced: the heading is printed as the last line of its chunk, so "the wording from the heading on" was
  empty.
- Fix (`sectionWording`, shared by both paths): an empty wording is read from the next chunk, up to the manual's next
  titled section.
- Ask Bubbles has its own `sectionWording` and the same layout can occur there. **Port this part when the loop is
  ported, or earlier if QA asks.**

## A plain heading ends at the next heading (QA2, 21 Nov 2026; a regression from #1146 on main 3b0038f4)

A card citing Attendance p.14 for plain lateness ("she was 40 minutes late on 11/18 …") saved the Late Opening
paragraph as Direct policy. `accountPassage` read the cited heading's text on into the next chunk, which is the
manual's next heading (Late Opening, chunk 42), and picked that block.

The fix:

- Only a heading printed as a list ("All Locations Dress Code:", ending in ":") runs on into the chunks of its
  sub-items.
- A plain heading ("Attendance") ends where the manual's next heading starts, in its own chunk or the next.
- So Late Opening is quoted only for a card that cites Late Opening.

Ask Bubbles: if its loop port (#991, Coding-D) copied `account-passage.ts` from #1146, it needs the same change.
That change is self-contained in that file: the `list` check and the `pick` split. This session cannot read the Ask
Bubbles repository, so QA2 relays it to Coding-D.

## A fit is a shared content word; a long list quotes its item (QA2's second #1146 case, 21 Nov 2026)

"ca for <P>, on the phone while a guest waited, 11/18", with the card citing Standards of Conduct p.12, saved the list
block "o Lack of sales performance o Indecent or immoral behavior …". It shared only the word "while" with the account.

- Grammar words never make a block fit.
- A plain heading runs on through its continuation chunks (no heading of their own: Standards of Conduct's list, chunks
  37–39) and stops at the next heading.
- A list block longer than an excerpt is narrowed to the item that fits. For example, "o Insubordination -the refusal to
  follow the directions of the manager."
- With no fit, the section's opening wording stands.

The replay pack's `manualAlsoHas(rows, { inPlace: true })` lets a case read production's own layout of those sections.
The same Bubbles relay applies: the whole change is in `account-passage.ts`.
