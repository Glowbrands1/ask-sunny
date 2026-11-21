import { typoFullNameToRosterEnabled } from "@/lib/config/chat-quality-flags";

type WarningLevel = "verbal" | "written";

/*
 * ============================================================================
 * THE LEVEL SAID AFTER "IS THIS FOR <NAME>?" IS THE CARD'S (TYPO_FULL_NAME_TO_ROSTER_ENABLED; QA's ruling on #776)
 * ============================================================================
 *
 * Ported from Ask Bubbles (QA's audit item 15.10, sf-b5; QA's ruling on #776, 12 Nov 2026; invented people): "create a ca form for Delphine Marlwoe Ostrander" — a typo of a
 * roster person's full name — is asked "Is this for **Delphine Marlowe Ostrander**?" first (QA, 12 Nov 2026: a typo can
 * be a different person, and the confirmation costs one turn). The next turn, "verbal warning The date she complained
 * was Oct 31st …", opens her card (NEAR_MISS_DETAILS_ACCEPT), but the level read it as a mention: "verbal warning" runs
 * into the account with no stop, so it is not a sentence of its own. After that question, a turn that OPENS with a level
 * ("verbal warning …", "written CA …"), on a Corrective Action card for the person asked about and with no level yet, is
 * this form's level; the reply says so in the words a stated level gets. Off, as given.
 */
/** This app's line when no level is stated (`ai/warning-level-clause.ts`). */
const ASKED = "You'll set the verbal/written warning level on the form — I won't guess at it.";
const CONFIRM = /^Is this for \*\*([^*\n]+)\*\*\?/;
const OPENS_WITH_LEVEL = /^\s*(?:(?:ok(?:ay)?|yes|yeah|yep|correct|right)[,.!\s]+)?(verbal|written)\s+(?:warning|ca|c\/a|corrective(?:\s+action)?)\b/i;

interface Turn {
  readonly role: string;
  readonly content: string;
}

interface Card {
  readonly templateKey?: string | null;
  readonly employeeName?: string | null;
  readonly warningLevel?: WarningLevel | null;
}

export function withConfirmedNameLevel<T extends { content: string; formProposal?: Card | null }>(
  answer: T,
  history: readonly Turn[],
  question: string,
): T {
  if (!typoFullNameToRosterEnabled()) return answer;
  const card = answer.formProposal;
  if (!card || card.templateKey !== "dpoa" || card.warningLevel || !card.employeeName || !answer.content.includes(ASKED)) return answer;
  const at = history.map((turn) => turn.role === "assistant" && CONFIRM.exec(String(turn.content))?.[1]?.trim()).lastIndexOf(card.employeeName);
  if (at === -1) return answer;
  const after = [...history.slice(at + 1).filter((turn) => turn.role === "user").map((turn) => String(turn.content)), question];
  const levels = new Set(after.map((turn) => OPENS_WITH_LEVEL.exec(turn)?.[1]?.toLowerCase()).filter((level): level is string => Boolean(level)));
  if (levels.size !== 1) return answer;
  const level = [...levels][0] as WarningLevel;
  const line = `**Type of Warning:** ${level === "verbal" ? "Verbal Warning" : "Written Warning"}, as you said — I'll tick it on the form. Tell me if that should change.`;
  return { ...answer, content: answer.content.replace(ASKED, line), formProposal: { ...card, warningLevel: level } };
}
