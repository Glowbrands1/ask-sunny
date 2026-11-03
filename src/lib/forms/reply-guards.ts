import { refusalNoRepeatEnabled, sameAskNoRepeatEnabled, titleNotSpeakersManagerEnabled } from "@/lib/config/chat-quality-flags";

/**
 * ============================================================================
 * TWO LAST CHECKS ON A REPLY (the 2 Nov 2026 scan, "CA for must see behaviors")
 * ============================================================================
 *
 * "It also gave the same refusal 3 times and listed a Tanning Consultant's job
 * title as District Manager."
 *
 * REFUSAL_NO_REPEAT_ENABLED — a REFUSAL ("won't", "can't", "isn't what …")
 * that opens with the same paragraph as the reply before it, and offers no
 * card, is not said again: the manager already has it. One line says so and
 * what would move things on. An ordinary answer is never held back.
 *
 * TITLE_NOT_SPEAKERS_MANAGER_ENABLED — "my DM told me she gets one this month"
 * is the manager's own District Manager, not the employee's title. A card
 * whose title is the role the manager called "my …" in this conversation
 * loses that title (the directory's, or the manager's own words for the
 * employee, apply), and the reply's Position line with it.
 */

interface Turn {
  readonly role: string;
  readonly content: string;
}

interface Answer {
  content: string;
  formProposal?: { employeeRole?: string | null; status?: string } | null;
  formUpdate?: unknown;
}

/** Only a refusal is held back: an ordinary answer may open the same way twice. */
const REFUSAL = /\b(?:won't|will\s+not|can't|cannot|can\s+not|not\s+able\s+to|isn't\s+what|unable\s+to|not\s+allowed|is\s+for\s+one\s+person\s+at\s+a\s+time)\b/i;

function opening(text: string): string {
  return (text.split(/\n\s*\n/)[0] ?? "").trim();
}

export function withoutRepeatedRefusal<T extends Answer>(answer: T, history: readonly Turn[]): T {
  if (!refusalNoRepeatEnabled() || answer.formProposal || answer.formUpdate) return answer;
  const previous = [...history].reverse().find((turn) => turn.role === "assistant")?.content ?? "";
  const first = opening(answer.content);
  if (first.length < 40 || first !== opening(previous) || !REFUSAL.test(first)) return answer;
  const metric = /\blow number on its own\b|\boff a metric\b/i.test(first);
  const onward = metric
    ? "If coaching for this has already happened, say so — for example \"we already did coaching on 10/14\" — and I'll start the Corrective Action Form. Otherwise I can start a Coaching Form now."
    : "Tell me what's different, or what you'd like me to do instead.";
  return { ...answer, content: `That's the same answer as my last reply — nothing new changes it. ${onward}` };
}

/**
 * SAME_ASK_NO_REPEAT_ENABLED (the replay pack, 3 Nov 2026): asked twice before
 * naming the salon or store, the team card asked "Which … is this about?"
 * twice, word for word. A card that still needs something and would repeat the
 * last reply exactly says first that it is still waiting on the same thing.
 * Only an exact repeat, and only on a card that is not ready.
 */
export function withoutRepeatedAsk<T extends Answer>(answer: T, history: readonly Turn[]): T {
  if (!sameAskNoRepeatEnabled() || !answer.formProposal || answer.formProposal.status === "ready") return answer;
  const previous = [...history].reverse().find((turn) => turn.role === "assistant")?.content ?? "";
  if (!previous.trim() || previous.trim() !== answer.content.trim()) return answer;
  /*
   * ONLY A REPLY THAT STILL ASKS SOMETHING (the replay eval, 3 Nov 2026): a card
   * shown again after "show draft" asks nothing, and "I still need the same
   * answer" would claim a question that is not there. The note names what the
   * reply asks for.
   */
  const asked = STILL_ASKED.find(([pattern]) => pattern.test(answer.content));
  if (!asked) return answer;
  return { ...answer, content: `${asked[1]}\n\n${answer.content}` };
}

/** The questions a card asks before it can be made, and the note that names each. */
const STILL_ASKED: readonly [RegExp, string][] = [
  [/\bwho is (?:this|it)\b[^?\n]*\bfor\?/i, "I still need to know who this is for before I can make this card."],
  [/\bwhich (?:salon|store|location)\b[^?\n]*\?/i, "I still need to know which location this is about before I can make this card."],
  [/\bwhich date goes on the form\?/i, "I still need to know which date goes on the form before I can make this card."],
];

/** "my DM", "my district manager", "my RD" … — the speaker's own manager, by role. */
const SPEAKERS_MANAGER: readonly [RegExp, RegExp][] = [
  [/\bmy\s+(?:dm|district\s+manager)\b/i, /^district\s+manager$/i],
  [/\bmy\s+(?:rd|regional\s+(?:director|manager))\b/i, /^regional\s+(?:director|manager)$/i],
];

export function withoutSpeakersManagerTitle<T extends Answer>(answer: T, managerTurns: readonly string[]): T {
  const role = answer.formProposal?.employeeRole?.trim();
  if (!titleNotSpeakersManagerEnabled() || !role) return answer;
  const said = managerTurns.join("\n");
  const hit = SPEAKERS_MANAGER.find(([phrase, title]) => title.test(role) && phrase.test(said));
  if (!hit) return answer;
  return {
    ...answer,
    content: answer.content.replace(new RegExp(`\\n?\\*\\*(?:Position|Job title):\\*\\*\\s*${role.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[^\\n]*`, "gi"), "").trim(),
    formProposal: { ...answer.formProposal!, employeeRole: null },
  };
}
