import { possessivePlaceNotPersonEnabled } from "@/lib/config/chat-quality-flags";

/*
 * ============================================================================
 * "<WORD>'S <PLACE>" IS A PLACE, NOT A PERSON (POSSESSIVE_PLACE_NOT_PERSON_ENABLED)
 * ============================================================================
 *
 * Ported from the sibling app (QA's round-6 live test there, 9 Nov 2026): a request for a form "for <Word>'s <Place>,
 * she was late on 10-20-26" made a card for Employee "<Word>". Here too, checked on main 24a380e5: "create a CA for
 * Hadley's Crossing Plaza, she was late on 10-20-26" made a card for "Hadley".
 *
 * With the flag on, the last check before the reply (after PERSON_GUARD): when every mention of the card's person in
 * the manager's words is "<Name>'s <Place>" — a possessive followed by a place word ("<Name>'s Plaza", "… Crossing
 * Plaza") — the card loses that name and asks who the form is for. A person named plainly anywhere keeps the card. No
 * salon name here has a possessive, so the sibling app's store-name half has no counterpart. Off, as before.
 */

const PLACE_WORD = String.raw`(?:plaza|mall|center|centre|square|crossing|commons|market(?:place)?|village|station|shops|shopping|store|location|park)`;

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Every mention of `name` in `said` is a possessive place, and there is at least one. */
export function onlyAsPossessivePlace(name: string, said: string): boolean {
  const word = name.trim();
  if (!word || /\s/.test(word)) return false;
  const mentions = [...said.matchAll(new RegExp(String.raw`(?<![\p{L}])${escape(word)}(?![\p{L}])`, "giu"))];
  if (mentions.length === 0) return false;
  const place = new RegExp(String.raw`^['’]s\s+(?:\p{L}+\s+){0,2}${PLACE_WORD}(?![\p{L}])`, "iu");
  return mentions.every((mention) => place.test(said.slice((mention.index ?? 0) + word.length)));
}

/** The question for a card whose only "person" is a place's possessive ("Hadley's Crossing Plaza"). */
export function possessivePlaceQuestion(form: string, word: string): string {
  return `Who is this **${form}** for? "${word}'s" is part of a place's name, not a person — tell me the employee's full name, and I'll fill in what you've already described.`;
}

interface CardLike {
  employeeName: string | null;
  employeeRole?: string | null;
  templateName?: string;
  subject?: string;
  status: string;
  supportsInlineDraft?: boolean;
}

export function withPossessivePlaceNotPerson<T extends { content: string; formProposal?: CardLike | null }>(
  answer: T,
  managerTurns: readonly string[],
): T {
  if (!possessivePlaceNotPersonEnabled()) return answer;
  const card = answer.formProposal;
  if (!card?.employeeName || card.subject === "team") return answer;
  if (!onlyAsPossessivePlace(card.employeeName, managerTurns.join("\n"))) return answer;
  return {
    ...answer,
    content: possessivePlaceQuestion(card.templateName ?? "form", card.employeeName),
    formProposal: { ...card, employeeName: null, employeeRole: null, status: "needs_employee", supportsInlineDraft: false },
  };
}
