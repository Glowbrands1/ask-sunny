import { lateOpeningNeedsOpeningEnabled } from "@/lib/config/chat-quality-flags";

/**
 * ============================================================================
 * A CLOSING ACCOUNT IS NEVER CITED AS LATE OPENING
 * ============================================================================
 *
 * LATE_OPENING_NEEDS_OPENING_ENABLED (QA's B4 (b); Pau via QA, sf-s25, 5 Nov 2026). "Write a CA for <name> … on
 * 11/3/26 she was scheduled until 9:15PM and clocked out at 9:01. She also took down the spray booths down at 8:11 PM
 * before the Salon was closed." — a closing account — came back citing "Late Opening Policy, JBA Policy Manual p.15"
 * with an Action Plan to review the Late Opening policy: the intent read returned the Late Opening heading (the live
 * trace). On: a card that cites Late Opening when nothing the manager typed for it says opening ("open", "opened",
 * "opening") and something says closing ("close", "closed", "closing") cites no policy instead — its Late Opening
 * lines go and the Action Plan reviews "the applicable company policy", as a card with no policy does — so neither the
 * card nor the draft made from it (which reads the card's policy line) says Late Opening. Any other card, or a closing
 * account that also says opening, is left as it is. Pure.
 */

const OPENING = /\bopen(?:s|ed|ing)?\b/i;
const CLOSING = /\bclos(?:e|ed|es|ing)\b/i;
const CITES = /\bLate Opening\b/i;

export function withLateOpeningNeedsOpening<T extends { content: string; formProposal?: { templateKey: string } | null }>(
  answer: T,
  managerTurns: readonly string[],
): T {
  if (!lateOpeningNeedsOpeningEnabled() || !answer.formProposal || !CITES.test(answer.content)) return answer;
  const said = managerTurns.join("\n");
  if (OPENING.test(said) || !CLOSING.test(said)) return answer;
  const content = answer.content
    .split("\n")
    .filter((line) => !(CITES.test(line) && (/\*\*Policy:?\*\*/i.test(line) || /^\s*Late Opening Policy\b/i.test(line))))
    .map((line) => line.replace(/\bthe Late Opening policy\b/gi, "the applicable company policy").replace(/\bLate Opening policy\b/gi, "applicable company policy"))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return content === answer.content ? answer : { ...answer, content };
}
