# Lesson page layout (Objective · Learn · Practice · Submit) — Ask Sunny only, for now

**Change:** the AI Training lesson page draws each lesson in four blocks —
Objective, Learn, Practice (numbered step cards), Submit (navy, with the
required checklist) — with a sticky section bar and Previous / Next links.
The lesson text is unchanged; `src/lib/ai-training/lesson-layout.ts` sorts the
stored markdown into the blocks.

**Ask Bubbles:** not ported yet. Pau asked for it "for Sunny for now"
(20 Nov 2026). Bubbles has the same AI Training feature, so the port is the
three files `lesson-layout.ts`, `catalog.ts` (`lessonNav`) and
`lesson-screen.tsx`, plus the CSS tokens under "AI TRAINING" in `globals.css`.
Not a bug fix: nothing in Bubbles is broken by the difference.
