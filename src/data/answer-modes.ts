/**
 * ============================================================================
 * THE ASSISTANT'S OWN VOCABULARY — PRODUCTION COPY, NOT SEEDED CONTENT
 * ============================================================================
 *
 * Answer-length labels, the standing manager note, and the source promise.
 * Every one of them is true of a live deployment: the note describes how a
 * manager should treat any answer, and `SOURCE_PROMISE` describes how every
 * answer is produced in live mode. None of it is demo content, and the
 * promise in particular is a claim the product has to keep.
 *
 * WHY IT MOVED OUT OF `data/demo/chat.ts`. It sat above 600 lines of seeded
 * answers and two seeded conversations. Three production components imported
 * a label from there — the composer, the message bubble and the answer sheet
 * — and an ES import is all-or-nothing, so the seeded conversations travelled
 * with the label into the client bundle. `conv-seed-1` was in production
 * JavaScript because a component wanted the word "Standard".
 */

import type { AnswerMode } from "@/types";

export const ANSWER_MODE_HELPER: Record<AnswerMode, string> = {
  quick: "Quick — the short answer, nothing else.",
  standard: "Standard — the answer with the why and the manager-ready next step.",
  detailed:
    "Detailed — the full picture, including what to document and where to verify it.",
};

export const ANSWER_MODE_LABEL: Record<AnswerMode, string> = {
  quick: "Quick",
  standard: "Standard",
  detailed: "Detailed",
};

/*
 * `SUGGESTED_PROMPTS` WAS HERE AND HAS MOVED TO `lib/ai/quick-questions.ts`.
 *
 * It was a flat list of six under this file's "DEMO CONTENT" header, and both
 * the Overview band and the chat screen rendered it in production — so the
 * questions the real product put in front of real managers were demo strings,
 * identical for a District Manager covering three districts and a frontline
 * employee with no reporting access. The replacement resolves them from the
 * reader's scope and permissions, which is not something a constant can do.
 *
 * The seeded follow-ups below are still demo content and still live here.
 */

/**
 * The standing note beneath the composer, in full.
 *
 * Still shown — reachable from the composer's info affordance — but no longer
 * as three permanently rendered lines above the fold. See MANAGER_NOTE_SHORT.
 */
export const MANAGER_NOTE =
  "Sunny supports your decision-making — it does not replace it. Verify official policy, HR, loss prevention, payroll, safety, and maintenance-risk actions through the right leadership channel before you act.";

/**
 * The one line that stays visible.
 *
 * The FIRST CLAUSE OF THE NOTE, WORD FOR WORD, rather than a paraphrase — it is
 * the sentence that carries the meaning, and a manager who reads nothing else
 * has still read the part that matters. The verification-channel detail is the
 * part that can wait for a hover, and it is one keystroke away rather than gone.
 */
export const MANAGER_NOTE_SHORT =
  "Sunny supports your decision-making — it does not replace it.";

/**
 * THE SOURCE PROMISE, WHICH IS A CLAIM THE PRODUCT HAS TO KEEP.
 *
 * One of the three trust facts the Marquee Chat artifact collapses onto a
 * single line inside the band. It is NOT demo copy — it describes how every
 * answer is produced in live mode as well — which is why it is separate from
 * the seeded-knowledge-base note below.
 *
 * That separation is the point of the artifact's punch-list item: "'This
 * prototype answers from a seeded demo knowledge base' — put behind the same
 * flag as the other demo strings so switching to real content is one toggle
 * rather than a copy hunt." The two sentences used to be one paragraph, so the
 * standing promise could not be shown without the prototype caveat.
 *
 * The promise is also what the restored Sources block under each answer makes
 * checkable — see `message-bubble.tsx`. A grounding claim a manager cannot
 * verify is worth less than no claim.
 */
export const SOURCE_PROMISE =
  "answers are generated from indexed company documents";
