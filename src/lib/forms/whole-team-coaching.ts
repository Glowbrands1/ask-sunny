import { wholeTeamCoachingEnabled } from "@/lib/config/chat-quality-flags";

import { readsAsTeamSubject } from "./team-subject";
import { detectTemplateIntent } from "./template-intent";

/**
 * ============================================================================
 * "WHOLE STAFF", SAID TO AN OPEN COACHING CARD, IS THE TEAM CARD
 * ============================================================================
 *
 * WHOLE_TEAM_COACHING_ENABLED. Ported from Ask Bubbles: a Location Manager, 2 Nov 2026, rated 1 star:
 * "earlier bubbles made a coaching form for all team members. Now it is
 * struggling to do that, it says it cannot make a coaching form for all team
 * members, but it just did it for me earlier". Pau, 3 Nov: "I need all
 * managers to have it".
 *
 * The team Coaching card ("All team members", one salon) is made by the form
 * intake (`team-subject.ts`, `buildProposal`). With the staff picker stepping
 * aside for a coaching form (`staff-picker.ts`), one gap was left: "Create a
 * coaching form." → "Who is this form for?" → "whole staff" / "for whole staff
 * - associates" / "for the whole salon" names no person, no salon and no
 * incident, so the intake let the turn go to the answering model, which wrote
 * its own refusal. Such a turn, while a Coaching card is open, is handed to
 * the intake as what it is — the Coaching Form for the whole team — in the
 * manager's own words. Nothing else changes: a turn that names a form is read
 * as it is, and with no Coaching card open nothing is rewritten.
 */
export function wholeTeamQuestion(question: string, continuingTemplateKey: string | null | undefined): string | null {
  if (!wholeTeamCoachingEnabled() || continuingTemplateKey !== "coaching") return null;
  if (!readsAsTeamSubject(question) || detectTemplateIntent(question).kind !== "none") return null;
  return `Coaching Form for the whole team: ${question}`;
}
