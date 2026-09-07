# Phase 1 — Chat workspace cleanup

Branch: `feature/chat-native-forms-marissa-feedback`
Started from: `c67f3f1` (approved Phase 0 / sequencing checkpoint)
Status: **implemented, automated gate green, Preview QA outstanding.**

Scope was the chat workspace's ergonomics and the citation count. **No forms
behaviour, no Supabase, no migration, no chat-persistence change, nothing
deployed.**

---

## What changed, and why

### The composer

It was taking roughly 165px of idle height. Four things were responsible, and
the text field was not one of them:

| Removed | Was |
|---|---|
| The answer-mode row | A full-width `SegmentedControl` on its own line above the input, with `mb-3` |
| The mode helper sentence | A second line restating what the three labels already say |
| Attach / image / voice | Three `disabled` buttons at `!opacity-40` plus a "Coming later" label |
| The standing manager note | 232 characters, wrapping to about three lines |

The mode control moved **inside** the composer surface, onto the row that already
held the send button. The two blocks of prose became one visible line and one
focusable info affordance.

**The text field was not touched.** `rows={1}`, auto-grow to `min(200, scrollHeight)`,
`max-h-50`, `resize-none`, `scroll-slim`, Enter to send, Shift+Enter for a
newline — all unchanged. It was already correct; the controls around it were the
problem.

**Answer modes are unchanged in every respect that matters.** Same three values,
same state wiring, same request payload, same model behaviour. The control is
still a Radix `ToggleGroup`, so it is still a real radio group: arrow-key
navigable, `aria-checked` rather than colour alone, each option its own named
button.

**The dead controls are gone rather than restyled.** They were honest — visibly
disabled, with tooltips explaining what they would one day do — and honesty was
not the problem. A manager reading a screen does not distinguish "not built yet"
from "broken". They come back when they work.

**What the disclaimer keeps.** The visible line is the *first clause of the note
verbatim* — "Sunny supports your decision-making — it does not replace it." — not
a paraphrase or a summary. The verification-channel sentence is on the info
affordance beside the modes. A safety note nobody has room to read is not a
safety note, but neither is one quietly shortened into something weaker.

### The chat viewport — two real defects

Requirement 4 asked for the flex/min-height/overflow chain to be audited rather
than patched. Two things were wrong.

**1. The workspace claimed more than the viewport.** `ChatScreen` read
`h-[calc(100dvh-3.5rem)] lg:h-dvh`. `AppShell` renders an `h-14` (3.5rem) header
above it in normal flow — a sticky element still occupies its space — so on every
laptop the workspace asked for the entire dynamic viewport while sitting 56px
down it. The page ended up 56px taller than the screen: a page-level scrollbar
with the composer below the fold, beneath a conversation pane that was already
short. One height is correct at every width, because the header is the same
height at every width. `lg:h-dvh` is gone.

**2. `min-h-0` was missing on the conversation column.** The column between the
fixed-height root and the scrolling message list sits in a *row* flex container,
where `min-height: auto` is the default and lets a child grow to fit its content
instead of scrolling inside its parent. Without it, a long answer pushes the
composer off-screen rather than engaging the `overflow-y-auto` that was already
on the list.

Net effect: roughly **80px** returned by the composer plus **56px** by the height
fix, on a laptop.

### The stray "3"

`SourceCardList` rendered its heading **and** an unlabelled
`<Badge>{citations.length}</Badge>` directly above cards numbered 1, 2, 3. A
manager read "Sources", then a floating "3", then a list starting at 1.

It was worse when several excerpts came from one document: the heading said
"Source" and the badge said "3" — two numbers, different units, neither labelled,
side by side.

The badge is gone and the heading carries the count with its units named:

| Shape | Heading |
|---|---|
| 1 excerpt, 1 document | `Source` |
| N excerpts, 1 document | `Source — N excerpts` |
| N excerpts, M documents | `Sources — M documents, N excerpts` |

**Presentation only.** Retrieval, ranking, citation content, source URLs and the
per-card numbering are untouched.

---

## Files changed

| File | Change |
|---|---|
| `src/features/chat/composer.tsx` | Rewritten: mode control inside the surface, dead controls removed, one info affordance, one disclaimer line |
| `src/features/chat/chat-screen.tsx` | `lg:h-dvh` removed; `min-h-0` added to the conversation column |
| `src/components/source-card.tsx` | Unlabelled count badge removed |
| `src/features/chat/message-bubble.tsx` | `sourceListTitle` names both units when they differ |
| `src/data/demo/chat.ts` | `MANAGER_NOTE_SHORT` added; `MANAGER_NOTE` unchanged and still used |
| `src/features/chat/composer.dom.test.tsx` | New — 18 tests |
| `src/components/source-card.dom.test.tsx` | New — 6 tests |
| `src/features/chat/chat-layout.test.ts` | New — 11 tests |

## Intentionally not changed

Chat persistence (still browser-local IndexedDB); anything in Forms; the
`ChatMessage` model; retrieval, ranking or RAG behaviour; answer-mode semantics
or the API payload; `AppShell` (shared by every page — the chat fix is
chat-scoped); and every deferred Marissa item — reporting overflow, navigation,
Overview, reviews copy, salon count, Manager Resources credit, Vercel toolbar,
the global eyebrow/contrast pass.

## Verification

**Suite: 2305 passed, 7 skipped, 116 files** — up from 2270/7/113. The increase is
exactly the 35 new tests; no existing test was modified or removed.
`tsc --noEmit` clean, `eslint` clean, `next build` compiled successfully.

**Mutation checks**, each reverted afterwards:

| Mutation | Tests failed |
|---|---|
| Restore the disabled attachment controls | 4 |
| Restore the stray citation count badge | 2 |
| Move the mode control back to a permanent row with its helper | 4 |
| Break mode switching | 1 |
| Break Enter-to-submit | 2 |
| Restore `lg:h-dvh` and drop the column's `min-h-0` | 2 |

**On the layout tests being structural.** jsdom does not lay out — every height
and `scrollHeight` reads 0 — so a test claiming to measure this viewport would be
measuring nothing. The contract *is* the class chain, so the class chain is what
is asserted. The pixels are Preview QA.

## Preview QA still required

Nothing below has been observed by a person. Automated DOM tests are not proof of
any of it.

- Laptop: a six-paragraph answer is readable in a meaningfully larger pane; the
  composer no longer takes height comparable to the answer area when empty; no
  page-level scrollbar.
- Mobile (~360px): no horizontal page overflow; the mode control and send button
  do not wrap into a tall toolbar; the composer stays usable above the virtual
  keyboard; the message pane scrolls naturally.
- The textarea genuinely grows as you type and caps with an internal scrollbar.
- The info tooltip opens on hover, on keyboard focus, and on tap.
- Source cards look right with 1, 2 and 5+ citations, and across 1 vs several
  documents.

## Out-of-scope findings — reported, not changed

1. **`MANAGER_NOTE` lives in `src/data/demo/chat.ts` but is live-mode copy.**
   `MANAGER_NOTE_SHORT` was added beside it rather than moving either, because
   the global demo/live copy separation is an explicitly deferred item. Worth
   folding into that phase.
2. **`AppShell`'s two intermediate flex containers lack `min-h-0`** (the column
   holding `main`, and `main` itself). Chat does not depend on it now that its
   root carries a fixed height, but any future page wanting a `flex-1` scrolling
   region under the shell will hit the same class of bug. Not changed here: it is
   shared by every page and belongs in the navigation/layout phase.
