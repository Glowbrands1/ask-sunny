# Agent loop: a third person named in this person's turn (16 Nov 2026)

**Sibling app: not needed.** Ask Bubbles has no agent loop yet; both rules live in `src/lib/ai/agent-loop/tools.ts`.

- A turn that names this card's person stays this person's turn even when it also names someone else ("… to her
  salon director Juno Paxton … I need a written CA" keeps Written): `otherPersonNamed`.
- A job title belongs to the name it is attached to (the nearest name in its sentence, by the name reader):
  "your salon director Juno Paxton" is never this person's `title_differs` (`titleSaidFor`).

Port both when Ask Bubbles gets the loop (salon ↔ store).
